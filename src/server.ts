import 'dotenv/config';
import Fastify from 'fastify';
import { logger } from '@/infrastructure/logger/winston.logger';
import { registerRoutes } from '@/presentation/routes';
import { errorHandler } from '@/presentation/middlewares/error-handler';
import { initOraclePool, closeOraclePool } from '@/infrastructure/database/oracle/oracle.connection';
import { connectMongo, disconnectMongo } from '@/infrastructure/database/mongo/mongo.connection';
import { connectRabbitMQ, closeRabbitMQ } from '@/infrastructure/messaging/rabbitmq/rabbitmq.connection';
import { TransactionWorker } from '@/infrastructure/messaging/rabbitmq/workers/TransactionWorker';
import { DecisionResultWorker } from '@/infrastructure/messaging/rabbitmq/workers/DecisionResultWorker';
import { RetryScheduler, assertRetryTopology, parseRetryDelays } from '@/infrastructure/messaging/rabbitmq/retry';
import { buildUpdateTransactionStatusUseCase } from '@/presentation/container';
import { N8nWebhookClient } from './infrastructure/external/n8n/N8nWebhookClient';
import { createBearerAuthHook } from '@/presentation/middlewares/bearer-auth';
import { createRateLimitHook } from '@/presentation/middlewares/rate-limit';
import { registerGracefulShutdown } from '@/infrastructure/lifecycle/graceful-shutdown';

const app = Fastify({
  logger: false,
  ajv: {
    customOptions: {
      removeAdditional: false,
    },
  },
});

app.setErrorHandler(errorHandler);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function bootstrap(): Promise<void> {
  const oraclePool = await initOraclePool();
  const mongoClient = await connectMongo();
  const rabbitChannel = await connectRabbitMQ();

  const transactionsQueue = process.env.RABBITMQ_QUEUE_TRANSACTIONS;
  let transactionWorker: TransactionWorker | undefined;
  let decisionResultWorker: DecisionResultWorker | undefined;

  if (transactionsQueue) {
    const decisionTransport = process.env.DECISION_TRANSPORT === 'queue' ? 'queue' : 'http';
    const retryDelays = parseRetryDelays(process.env.RETRY_DELAYS_MS);

    const deadLetterExchange = `${transactionsQueue}.dlx`;
    const deadLetterQueue = `${transactionsQueue}.dead`;
    const decisionRequestsQueue = `${transactionsQueue}.decision.requests`;
    const decisionResultsQueue = `${transactionsQueue}.decision.results`;

    await rabbitChannel.assertExchange(deadLetterExchange, 'fanout', { durable: true });
    await rabbitChannel.assertQueue(deadLetterQueue, { durable: true });
    await rabbitChannel.bindQueue(deadLetterQueue, deadLetterExchange, '');

    await rabbitChannel.assertExchange('amq.topic', 'topic', { durable: true });
    await rabbitChannel.assertQueue(transactionsQueue, { durable: true, deadLetterExchange });
    await rabbitChannel.assertQueue(decisionRequestsQueue, { durable: true, deadLetterExchange });
    await rabbitChannel.assertQueue(decisionResultsQueue, { durable: true, deadLetterExchange });

    const [filaAtiva, filaOciosa] = decisionTransport === 'queue'
      ? [decisionRequestsQueue, transactionsQueue]
      : [transactionsQueue, decisionRequestsQueue];

    await rabbitChannel.bindQueue(filaAtiva, 'amq.topic', 'transaction.created');
    await rabbitChannel.unbindQueue(filaOciosa, 'amq.topic', 'transaction.created');

    if (decisionTransport === 'queue') {
      await rabbitChannel.bindQueue(decisionResultsQueue, 'amq.topic', 'transaction.decided');
    } else {
      await rabbitChannel.unbindQueue(decisionResultsQueue, 'amq.topic', 'transaction.decided');
    }

    logger.info('Transporte de decisão configurado', {
      transport: decisionTransport,
      filaDePedidos: filaAtiva,
      filaDesligada: filaOciosa,
    });

    if (decisionTransport === 'http') {
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
      if (!n8nWebhookUrl) {
        throw new Error('N8N_WEBHOOK_URL is not defined');
      }
      const n8nWebhookToken = process.env.N8N_WEBHOOK_TOKEN;
      if (!n8nWebhookToken) {
        throw new Error('N8N_WEBHOOK_TOKEN is not defined');
      }

      const decisionGateway = new N8nWebhookClient(n8nWebhookUrl, n8nWebhookToken);
      await assertRetryTopology(rabbitChannel, transactionsQueue, retryDelays);
      transactionWorker = new TransactionWorker(
        rabbitChannel,
        transactionsQueue,
        decisionGateway,
        new RetryScheduler(rabbitChannel, transactionsQueue, retryDelays),
      );
      await transactionWorker.start();
    } else {
      await assertRetryTopology(rabbitChannel, decisionResultsQueue, retryDelays);
      decisionResultWorker = new DecisionResultWorker(
        rabbitChannel,
        decisionResultsQueue,
        buildUpdateTransactionStatusUseCase(oraclePool),
        new RetryScheduler(rabbitChannel, decisionResultsQueue, retryDelays),
      );
      await decisionResultWorker.start();
    }
  }

  const callbackAuthToken = process.env.CALLBACK_AUTH_TOKEN;
  if (!callbackAuthToken) {
    throw new Error('CALLBACK_AUTH_TOKEN is not defined');
  }

  const apiAuthToken = process.env.API_AUTH_TOKEN;
  if (!apiAuthToken) {
    throw new Error('API_AUTH_TOKEN is not defined');
  }

  const rateLimitHook = createRateLimitHook({
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  });

  await registerRoutes(
    app,
    oraclePool,
    rabbitChannel,
    mongoClient.connection,
    createBearerAuthHook(callbackAuthToken),
    createBearerAuthHook(apiAuthToken),
    rateLimitHook,
  );

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Server listening on ${HOST}:${PORT}`);
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
  
  registerGracefulShutdown({
    steps: [
      { name: 'http-server', run: () => app.close() },
      { name: 'transaction-worker', run: async () => transactionWorker?.stop() },
      { name: 'decision-result-worker', run: async () => decisionResultWorker?.stop() },
      { name: 'rabbitmq', run: closeRabbitMQ },
      { name: 'mongodb', run: disconnectMongo },
      { name: 'oracle-pool', run: closeOraclePool },
    ],
  });
}

bootstrap();

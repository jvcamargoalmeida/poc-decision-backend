import 'dotenv/config';
import Fastify from 'fastify';
import { logger } from '@/infrastructure/logger/winston.logger';
import { registerRoutes } from '@/presentation/routes';
import { errorHandler } from '@/presentation/middlewares/error-handler';
import { initOraclePool, closeOraclePool } from '@/infrastructure/database/oracle/oracle.connection';
import { connectMongo, disconnectMongo } from '@/infrastructure/database/mongo/mongo.connection';
import { connectRabbitMQ, closeRabbitMQ } from '@/infrastructure/messaging/rabbitmq/rabbitmq.connection';
import { TransactionWorker } from '@/infrastructure/messaging/rabbitmq/workers/TransactionWorker';
import { N8nWebhookClient } from './infrastructure/external/n8n/N8nWebhookClient';
import { createBearerAuthHook } from '@/presentation/middlewares/bearer-auth';
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

  if (transactionsQueue) {
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nWebhookUrl) {
      throw new Error('N8N_WEBHOOK_URL is not defined');
    }

    const deadLetterExchange = `${transactionsQueue}.dlx`;
    const deadLetterQueue = `${transactionsQueue}.dead`;

    await rabbitChannel.assertExchange(deadLetterExchange, 'fanout', { durable: true });
    await rabbitChannel.assertQueue(deadLetterQueue, { durable: true });
    await rabbitChannel.bindQueue(deadLetterQueue, deadLetterExchange, '');

    await rabbitChannel.assertExchange('amq.topic', 'topic', { durable: true });
    await rabbitChannel.assertQueue(transactionsQueue, { durable: true, deadLetterExchange });
    await rabbitChannel.bindQueue(transactionsQueue, 'amq.topic', 'transaction.created');
    const decisionGateway = new N8nWebhookClient(n8nWebhookUrl);
    transactionWorker = new TransactionWorker(rabbitChannel, transactionsQueue, decisionGateway);
    await transactionWorker.start();
  }

  const callbackAuthToken = process.env.CALLBACK_AUTH_TOKEN;
  if (!callbackAuthToken) {
    throw new Error('CALLBACK_AUTH_TOKEN is not defined');
  }

  await registerRoutes(
    app,
    oraclePool,
    rabbitChannel,
    mongoClient.connection,
    createBearerAuthHook(callbackAuthToken),
  );

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Server listening on ${HOST}:${PORT}`);
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }

  // Ordem importa: primeiro paramos de aceitar trabalho novo (HTTP e consumo da
  // fila), só depois fechamos as conexões que esse trabalho usaria.
  registerGracefulShutdown({
    steps: [
      { name: 'http-server', run: () => app.close() },
      { name: 'transaction-worker', run: async () => transactionWorker?.stop() },
      { name: 'rabbitmq', run: closeRabbitMQ },
      { name: 'mongodb', run: disconnectMongo },
      { name: 'oracle-pool', run: closeOraclePool },
    ],
  });
}

bootstrap();

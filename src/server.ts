import 'dotenv/config';
import Fastify from 'fastify';
import { logger } from '@/infrastructure/logger/winston.logger';
import { registerRoutes } from '@/presentation/routes';
import { errorHandler } from '@/presentation/middlewares/error-handler';
import { initOraclePool } from '@/infrastructure/database/oracle/oracle.connection';
import { connectMongo } from '@/infrastructure/database/mongo/mongo.connection';
import { connectRabbitMQ } from '@/infrastructure/messaging/rabbitmq/rabbitmq.connection';
import { TransactionWorker } from '@/infrastructure/messaging/rabbitmq/workers/TransactionWorker';

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

  if (transactionsQueue) {
    await rabbitChannel.assertExchange('amq.topic', 'topic', { durable: true });
    await rabbitChannel.assertQueue(transactionsQueue);
    await rabbitChannel.bindQueue(transactionsQueue, 'amq.topic', 'transaction.created');
    const transactionWorker = new TransactionWorker(rabbitChannel, transactionsQueue);
    await transactionWorker.start();
  }

  await registerRoutes(app, oraclePool, rabbitChannel, mongoClient.connection);

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Server listening on ${HOST}:${PORT}`);
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

bootstrap();

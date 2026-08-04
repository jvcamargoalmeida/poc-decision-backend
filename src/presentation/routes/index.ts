import type { FastifyInstance } from 'fastify';
import type oracledb from 'oracledb';
import { healthPlugin } from '@/presentation/plugins/health.plugin';
import { registerTransactionRoutes } from '@/presentation/routes/transaction.routes';
import { buildTransactionController } from '@/presentation/container';
import { type Channel } from 'amqplib';
import { Connection } from 'mongoose';


export async function registerRoutes(app: FastifyInstance, oraclePool: oracledb.Pool, channel: Channel, mongoClient: Connection): Promise<void> {
  await app.register(healthPlugin);

  const transactionController = buildTransactionController(oraclePool, channel, mongoClient);
  await registerTransactionRoutes(app, transactionController);
}

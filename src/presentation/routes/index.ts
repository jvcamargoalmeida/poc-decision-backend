import type { FastifyInstance } from 'fastify';
import type oracledb from 'oracledb';
import { healthPlugin } from '@/presentation/plugins/health.plugin';
import { registerTransactionRoutes } from '@/presentation/routes/transaction.routes';
import { registerCallbackRoutes } from '@/presentation/routes/callback.routes';
import { buildTransactionController, buildCallbackController } from '@/presentation/container';
import { type Channel } from 'amqplib';
import { Connection } from 'mongoose';
import type { BearerAuthHook } from '@/presentation/middlewares/bearer-auth';


export async function registerRoutes(
  app: FastifyInstance,
  oraclePool: oracledb.Pool,
  channel: Channel,
  mongoClient: Connection,
  callbackAuthHook: BearerAuthHook,
): Promise<void> {
  await app.register(healthPlugin);

  const transactionController = buildTransactionController(oraclePool, channel, mongoClient);
  await registerTransactionRoutes(app, transactionController);

  const callbackController = buildCallbackController(oraclePool);
  await registerCallbackRoutes(app, callbackController, callbackAuthHook);
}

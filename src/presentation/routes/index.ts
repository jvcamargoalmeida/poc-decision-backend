import type { FastifyInstance } from 'fastify';
import type oracledb from 'oracledb';
import { healthPlugin } from '@/presentation/plugins/health.plugin';
import { registerTransactionRoutes } from '@/presentation/routes/transaction.routes';
import { registerCallbackRoutes } from '@/presentation/routes/callback.routes';
import { buildTransactionController, buildCallbackController } from '@/presentation/container';
import { type Channel } from 'amqplib';
import { Connection } from 'mongoose';
import type { BearerAuthHook, ClientAuthHook } from '@/presentation/middlewares/bearer-auth';
import type { RateLimitHook } from '@/presentation/middlewares/rate-limit';


export async function registerRoutes(
  app: FastifyInstance,
  oraclePool: oracledb.Pool,
  channel: Channel,
  mongoClient: Connection,
  callbackAuthHook: BearerAuthHook,
  apiAuthHook: ClientAuthHook,
  rateLimitHook: RateLimitHook,
): Promise<void> {
  await app.register(healthPlugin);

  const transactionController = buildTransactionController(oraclePool, channel, mongoClient);
  await registerTransactionRoutes(app, transactionController, apiAuthHook, rateLimitHook);

  const callbackController = buildCallbackController(oraclePool);
  await registerCallbackRoutes(app, callbackController, callbackAuthHook, rateLimitHook);
}

import type { FastifyInstance } from 'fastify';
import type oracledb from 'oracledb';
import { healthPlugin } from '@/presentation/plugins/health.plugin';
import { registerTransactionRoutes } from '@/presentation/routes/transaction.routes';
import { buildTransactionController } from '@/presentation/container';

export async function registerRoutes(app: FastifyInstance, oraclePool: oracledb.Pool): Promise<void> {
  await app.register(healthPlugin);

  const transactionController = buildTransactionController(oraclePool);
  await registerTransactionRoutes(app, transactionController);
}

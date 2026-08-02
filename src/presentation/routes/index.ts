import type { FastifyInstance } from 'fastify';
import { healthPlugin } from '@/presentation/plugins/health.plugin';

// TODO: registrar rotas de dominio (ex: transactions, statistics) aqui
// conforme os Use Cases forem implementados manualmente.
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthPlugin);
}

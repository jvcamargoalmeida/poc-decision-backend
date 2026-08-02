import type { FastifyInstance } from 'fastify';

export async function healthPlugin(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
}

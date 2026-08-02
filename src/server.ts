import 'dotenv/config';
import Fastify from 'fastify';
import { logger } from '@/infrastructure/logger/winston.logger';
import { registerRoutes } from '@/presentation/routes';

const app = Fastify({
  logger: false,
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function bootstrap(): Promise<void> {
  await registerRoutes(app);

  // TODO: inicializar pool Oracle (initOraclePool), conexao Mongo (connectMongo)
  // e conexao RabbitMQ (connectRabbitMQ) aqui, e injetar nos Use Cases.

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Server listening on ${HOST}:${PORT}`);
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

bootstrap();

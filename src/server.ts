import 'dotenv/config';
import Fastify from 'fastify';
import { logger } from '@/infrastructure/logger/winston.logger';
import { registerRoutes } from '@/presentation/routes';
import { errorHandler } from '@/presentation/middlewares/error-handler';
import { initOraclePool } from '@/infrastructure/database/oracle/oracle.connection';

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

  await registerRoutes(app, oraclePool);

  // TODO: inicializar conexao Mongo (connectMongo) e conexao RabbitMQ
  // (connectRabbitMQ) aqui, e injetar nos Use Cases (Fase 4/5).

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Server listening on ${HOST}:${PORT}`);
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

bootstrap();

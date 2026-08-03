import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '@/infrastructure/logger/winston.logger';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  logger.error('Erro não tratado na requisição', {
    error: error.message,
    method: request.method,
    url: request.url,
  });

  if (error.validation) {
    reply.status(400).send({
      error: 'ValidationError',
      message: error.message,
    });
    return;
  }

  const statusCode = error.statusCode ?? 500;

  reply.status(statusCode).send({
    error: statusCode === 500 ? 'InternalServerError' : error.name,
    message: statusCode === 500 ? 'Erro interno no servidor' : error.message,
  });
}

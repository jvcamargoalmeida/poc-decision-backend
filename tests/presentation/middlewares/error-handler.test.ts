import { describe, expect, it, vi } from 'vitest';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { errorHandler } from '@/presentation/middlewares/error-handler';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function createFakeReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
  return reply as unknown as FastifyReply & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

const fakeRequest = { method: 'POST', url: '/transactions' } as FastifyRequest;

describe('errorHandler', () => {
  it('responde 400 com ValidationError quando o erro vem da validação de schema', () => {
    const error = {
      message: "body must have required property 'amount'",
      validation: [{ keyword: 'required' }],
    } as unknown as FastifyError;
    const reply = createFakeReply();

    errorHandler(error, fakeRequest, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'ValidationError',
      message: error.message,
    });
  });

  it('responde com o statusCode e nome do erro quando definidos e diferentes de 500', () => {
    const error = {
      message: 'recurso não encontrado',
      statusCode: 404,
      name: 'NotFoundError',
    } as unknown as FastifyError;
    const reply = createFakeReply();

    errorHandler(error, fakeRequest, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'NotFoundError',
      message: 'recurso não encontrado',
    });
  });

  it('responde 500 com mensagem genérica quando o erro não tem statusCode', () => {
    const error = { message: 'boom' } as unknown as FastifyError;
    const reply = createFakeReply();

    errorHandler(error, fakeRequest, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'InternalServerError',
      message: 'Erro interno no servidor',
    });
  });
});

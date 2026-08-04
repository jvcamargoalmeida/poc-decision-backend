import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CallbackController } from '@/presentation/controllers/CallbackController';
import { UpdateTransactionStatusUseCase } from '@/application/use-cases/UpdateTransactionStatusUseCase';
import { TransactionNotFoundError } from '@/domain/errors/TransactionNotFoundError';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

type CallbackRequest = FastifyRequest<{ Body: { id: string; status: TransactionStatus } }>;

function createFakeReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockResolvedValue(undefined),
  };
  return reply as unknown as FastifyReply & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe('CallbackController', () => {
  it('delega ao use case e responde 200 em caso de sucesso', async () => {
    const updateTransactionStatusUseCase = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as UpdateTransactionStatusUseCase;

    const controller = new CallbackController(updateTransactionStatusUseCase);
    const request = { body: { id: 'tx-id', status: TransactionStatus.COMPLETED } } as CallbackRequest;
    const reply = createFakeReply();

    await controller.handle(request, reply);

    expect(updateTransactionStatusUseCase.execute).toHaveBeenCalledWith('tx-id', TransactionStatus.COMPLETED);
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Callback processed successfully' });
  });

  it('responde 404 quando a transação não é encontrada', async () => {
    const updateTransactionStatusUseCase = {
      execute: vi.fn().mockRejectedValue(new TransactionNotFoundError('tx-id')),
    } as unknown as UpdateTransactionStatusUseCase;

    const controller = new CallbackController(updateTransactionStatusUseCase);
    const request = { body: { id: 'tx-id', status: TransactionStatus.COMPLETED } } as CallbackRequest;
    const reply = createFakeReply();

    await controller.handle(request, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Transação com ID tx-id não encontrada' });
  });

  it('responde 500 sem vazar detalhe do erro quando algo inesperado falha', async () => {
    const updateTransactionStatusUseCase = {
      execute: vi.fn().mockRejectedValue(new Error('falha inesperada no Oracle')),
    } as unknown as UpdateTransactionStatusUseCase;

    const controller = new CallbackController(updateTransactionStatusUseCase);
    const request = { body: { id: 'tx-id', status: TransactionStatus.COMPLETED } } as CallbackRequest;
    const reply = createFakeReply();

    await controller.handle(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Error processing callback' });
  });
});

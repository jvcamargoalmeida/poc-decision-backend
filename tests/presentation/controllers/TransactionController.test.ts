import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TransactionController } from '@/presentation/controllers/TransactionController';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { RiskLevel } from '@/domain/enums/RiskLevel';
import type { Transaction } from '@/domain/entities/Transaction';

type CreateTransactionRequest = FastifyRequest<{ Body: { amount: number; currency: string } }>;

function createFakeReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockResolvedValue(undefined),
  };
  return reply as unknown as FastifyReply & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe('TransactionController', () => {
  it('delega ao use case e responde 201 com a transação criada', async () => {
    const savedTransaction: Transaction = {
      id: 'generated-id',
      amount: 100,
      currency: 'BRL',
      status: TransactionStatus.PENDING,
      riskScore: RiskLevel.LOW,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const processTransactionUseCase = {
      execute: vi.fn().mockResolvedValue(savedTransaction),
    } as unknown as ProcessTransactionUseCase;

    const controller = new TransactionController(processTransactionUseCase);
    const request = { body: { amount: 100, currency: 'BRL' }, headers: {} } as unknown as CreateTransactionRequest;
    const reply = createFakeReply();

    await controller.create(request, reply);

    expect(processTransactionUseCase.execute).toHaveBeenCalledWith(100, 'BRL', undefined);
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith(savedTransaction);
  });

  it('propaga o erro do use case sem tratá-lo (delega ao error handler global)', async () => {
    const useCaseError = new Error('falha ao processar transação');
    const processTransactionUseCase = {
      execute: vi.fn().mockRejectedValue(useCaseError),
    } as unknown as ProcessTransactionUseCase;

    const controller = new TransactionController(processTransactionUseCase);
    const request = { body: { amount: 100, currency: 'BRL' }, headers: {} } as unknown as CreateTransactionRequest;
    const reply = createFakeReply();

    await expect(controller.create(request, reply)).rejects.toThrow(useCaseError);
  });

  it('repassa o header Idempotency-Key ao use case', async () => {
    const processTransactionUseCase = {
      execute: vi.fn().mockResolvedValue({} as Transaction),
    } as unknown as ProcessTransactionUseCase;

    const controller = new TransactionController(processTransactionUseCase);
    const request = {
      body: { amount: 100, currency: 'BRL' },
      headers: { 'idempotency-key': 'chave-abc' },
    } as unknown as CreateTransactionRequest;

    await controller.create(request, createFakeReply());

    expect(processTransactionUseCase.execute).toHaveBeenCalledWith(100, 'BRL', 'chave-abc');
  });

  it('passa undefined quando o cliente não envia a chave', async () => {
    const processTransactionUseCase = {
      execute: vi.fn().mockResolvedValue({} as Transaction),
    } as unknown as ProcessTransactionUseCase;

    const controller = new TransactionController(processTransactionUseCase);
    const request = { body: { amount: 100, currency: 'BRL' }, headers: {} } as unknown as CreateTransactionRequest;

    await controller.create(request, createFakeReply());

    expect(processTransactionUseCase.execute).toHaveBeenCalledWith(100, 'BRL', undefined);
  });
});

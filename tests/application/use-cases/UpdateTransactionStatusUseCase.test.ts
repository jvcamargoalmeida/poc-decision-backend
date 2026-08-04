import { describe, expect, it, vi } from 'vitest';
import { UpdateTransactionStatusUseCase } from '@/application/use-cases/UpdateTransactionStatusUseCase';
import { TransactionNotFoundError } from '@/domain/errors/TransactionNotFoundError';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { RiskLevel } from '@/domain/enums/RiskLevel';
import type { Transaction } from '@/domain/entities/Transaction';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function createDeps() {
  const transactionRepository: ITransactionRepository = {
    save: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
  };
  return { transactionRepository };
}

const existingTransaction: Transaction = {
  id: 'tx-id',
  amount: 100,
  currency: 'BRL',
  status: TransactionStatus.PENDING,
  riskScore: RiskLevel.LOW,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('UpdateTransactionStatusUseCase', () => {
  it('atualiza o status quando a transação existe', async () => {
    const { transactionRepository } = createDeps();
    vi.mocked(transactionRepository.findById).mockResolvedValue(existingTransaction);
    vi.mocked(transactionRepository.updateStatus).mockResolvedValue(undefined);

    const useCase = new UpdateTransactionStatusUseCase(transactionRepository);
    await useCase.execute('tx-id', TransactionStatus.COMPLETED);

    expect(transactionRepository.findById).toHaveBeenCalledWith('tx-id');
    expect(transactionRepository.updateStatus).toHaveBeenCalledWith('tx-id', TransactionStatus.COMPLETED);
  });

  it('lança TransactionNotFoundError quando a transação não existe, sem chamar updateStatus', async () => {
    const { transactionRepository } = createDeps();
    vi.mocked(transactionRepository.findById).mockResolvedValue(null);

    const useCase = new UpdateTransactionStatusUseCase(transactionRepository);

    await expect(useCase.execute('missing-id', TransactionStatus.COMPLETED)).rejects.toThrow(TransactionNotFoundError);
    expect(transactionRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('propaga o erro quando updateStatus falha', async () => {
    const { transactionRepository } = createDeps();
    vi.mocked(transactionRepository.findById).mockResolvedValue(existingTransaction);
    const updateError = new Error('falha ao atualizar status');
    vi.mocked(transactionRepository.updateStatus).mockRejectedValue(updateError);

    const useCase = new UpdateTransactionStatusUseCase(transactionRepository);

    await expect(useCase.execute('tx-id', TransactionStatus.FAILED)).rejects.toThrow(updateError);
  });
});

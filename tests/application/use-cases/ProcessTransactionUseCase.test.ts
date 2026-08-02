import { describe, expect, it, vi } from 'vitest';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { IRiskStrategy } from '@/domain/strategies/risk/IRiskStrategy';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { RiskLevel } from '@/domain/enums/RiskLevel';
import type { Transaction } from '@/domain/entities/Transaction';

function createDeps() {
  const transactionRepository: ITransactionRepository = {
    save: vi.fn(),
    findById: vi.fn(),
  };
  const riskStrategy: IRiskStrategy = {
    calculateRisk: vi.fn(),
  };
  return { transactionRepository, riskStrategy };
}

describe('ProcessTransactionUseCase', () => {
  it('calcula o risco, monta a transação como PENDING e delega a persistência ao repositório', async () => {
    const { transactionRepository, riskStrategy } = createDeps();
    vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);

    const savedTransaction: Transaction = {
      id: 'generated-id',
      amount: 250,
      currency: 'BRL',
      status: TransactionStatus.PENDING,
      riskScore: RiskLevel.LOW,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    vi.mocked(transactionRepository.save).mockResolvedValue(savedTransaction);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy);
    const result = await useCase.execute(250, 'BRL');

    expect(riskStrategy.calculateRisk).toHaveBeenCalledWith(250);
    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 250,
        currency: 'BRL',
        status: TransactionStatus.PENDING,
        riskScore: RiskLevel.LOW,
      }),
    );
    expect(result).toEqual(savedTransaction);
  });

  it('propaga o erro quando o repositório falha ao salvar', async () => {
    const { transactionRepository, riskStrategy } = createDeps();
    vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.HIGH);
    const repositoryError = new Error('falha ao persistir transação');
    vi.mocked(transactionRepository.save).mockRejectedValue(repositoryError);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy);

    await expect(useCase.execute(50000, 'USD')).rejects.toThrow(repositoryError);
  });
});

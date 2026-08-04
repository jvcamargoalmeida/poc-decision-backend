import { describe, expect, it, vi } from 'vitest';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { IRiskStrategy } from '@/domain/strategies/risk/IRiskStrategy';
import { IEventPublisher } from '@/domain/events/IEventPublisher';
import { IAuditRepository } from '@/domain/repositories/IAuditRepository';
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
  const riskStrategy: IRiskStrategy = {
    calculateRisk: vi.fn(),
  };
  const mqPublisher: IEventPublisher = {
    publish: vi.fn(),
  };
  const auditRepository: IAuditRepository = {
    logTransaction: vi.fn(),
  };
  return { transactionRepository, riskStrategy, mqPublisher, auditRepository };
}

describe('ProcessTransactionUseCase', () => {
  it('calcula o risco, persiste a transação e só então publica o evento e grava o audit log', async () => {
    const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
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
    vi.mocked(mqPublisher.publish).mockResolvedValue(undefined);
    vi.mocked(auditRepository.logTransaction).mockResolvedValue(undefined);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);
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
    expect(mqPublisher.publish).toHaveBeenCalledWith('transaction.created', savedTransaction);
    expect(auditRepository.logTransaction).toHaveBeenCalledWith('generated-id', savedTransaction);
    expect(result).toEqual(savedTransaction);
  });

  it('propaga o erro quando o repositório falha ao salvar, sem publicar evento nem gravar audit log', async () => {
    const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
    vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.HIGH);
    const repositoryError = new Error('falha ao persistir transação');
    vi.mocked(transactionRepository.save).mockRejectedValue(repositoryError);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

    await expect(useCase.execute(50000, 'USD')).rejects.toThrow(repositoryError);
    expect(mqPublisher.publish).not.toHaveBeenCalled();
    expect(auditRepository.logTransaction).not.toHaveBeenCalled();
  });

  it('lança erro quando o repositório salva sem retornar um ID', async () => {
    const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
    vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);
    vi.mocked(transactionRepository.save).mockResolvedValue({
      amount: 100,
      currency: 'BRL',
      status: TransactionStatus.PENDING,
      riskScore: RiskLevel.LOW,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as Transaction);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

    await expect(useCase.execute(100, 'BRL')).rejects.toThrow('Erro ao salvar transação: ID não gerado');
    expect(mqPublisher.publish).not.toHaveBeenCalled();
    expect(auditRepository.logTransaction).not.toHaveBeenCalled();
  });

  it('propaga o erro quando a publicação do evento falha', async () => {
    const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
    vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);
    const savedTransaction: Transaction = {
      id: 'generated-id',
      amount: 100,
      currency: 'BRL',
      status: TransactionStatus.PENDING,
      riskScore: RiskLevel.LOW,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    vi.mocked(transactionRepository.save).mockResolvedValue(savedTransaction);
    const publishError = new Error('falha ao publicar evento');
    vi.mocked(mqPublisher.publish).mockRejectedValue(publishError);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

    await expect(useCase.execute(100, 'BRL')).rejects.toThrow(publishError);
    expect(auditRepository.logTransaction).not.toHaveBeenCalled();
  });

  it('propaga o erro quando a gravação do audit log falha', async () => {
    const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
    vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);
    const savedTransaction: Transaction = {
      id: 'generated-id',
      amount: 100,
      currency: 'BRL',
      status: TransactionStatus.PENDING,
      riskScore: RiskLevel.LOW,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    vi.mocked(transactionRepository.save).mockResolvedValue(savedTransaction);
    vi.mocked(mqPublisher.publish).mockResolvedValue(undefined);
    const auditError = new Error('falha ao gravar audit log');
    vi.mocked(auditRepository.logTransaction).mockRejectedValue(auditError);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

    await expect(useCase.execute(100, 'BRL')).rejects.toThrow(auditError);
  });
});

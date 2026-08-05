import { describe, expect, it, vi } from 'vitest';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { IRiskStrategy } from '@/domain/strategies/risk/IRiskStrategy';
import { IEventPublisher } from '@/domain/events/IEventPublisher';
import { IAuditRepository } from '@/domain/repositories/IAuditRepository';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { RiskLevel } from '@/domain/enums/RiskLevel';
import { DuplicateIdempotencyKeyError } from '@/domain/errors/DuplicateIdempotencyKeyError';
import type { Transaction } from '@/domain/entities/Transaction';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function createDeps() {
  const transactionRepository: ITransactionRepository = {
    save: vi.fn(),
    findById: vi.fn(),
    findByIdempotencyKey: vi.fn(),
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
    expect(auditRepository.logTransaction).toHaveBeenCalledWith('generated-id', savedTransaction, undefined);
    expect(result).toEqual(savedTransaction);
  });

  it('grava o cliente que originou a requisição no audit log', async () => {
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
    vi.mocked(auditRepository.logTransaction).mockResolvedValue(undefined);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);
    await useCase.execute(100, 'BRL', undefined, 'parceiro-a');

    expect(auditRepository.logTransaction).toHaveBeenCalledWith('generated-id', savedTransaction, 'parceiro-a');
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

  it('não derruba a resposta quando a publicação do evento falha — a transação já está persistida', async () => {
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
    vi.mocked(mqPublisher.publish).mockRejectedValue(new Error('RabbitMQ fora do ar'));
    vi.mocked(auditRepository.logTransaction).mockResolvedValue(undefined);

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

    await expect(useCase.execute(100, 'BRL')).resolves.toEqual(savedTransaction);
    expect(auditRepository.logTransaction).toHaveBeenCalled();
  });

  it('não derruba a resposta quando a gravação do audit log falha', async () => {
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
    vi.mocked(auditRepository.logTransaction).mockRejectedValue(new Error('Mongo fora do ar'));

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

    await expect(useCase.execute(100, 'BRL')).resolves.toEqual(savedTransaction);
    expect(mqPublisher.publish).toHaveBeenCalled();
  });

  it('ainda responde com sucesso quando evento E auditoria falham juntos', async () => {
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
    vi.mocked(mqPublisher.publish).mockRejectedValue(new Error('RabbitMQ fora do ar'));
    vi.mocked(auditRepository.logTransaction).mockRejectedValue(new Error('Mongo fora do ar'));

    const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

    await expect(useCase.execute(100, 'BRL')).resolves.toEqual(savedTransaction);
  });

  describe('idempotência', () => {
    const existente: Transaction = {
      id: 'tx-original',
      amount: 100,
      currency: 'BRL',
      status: TransactionStatus.PENDING,
      riskScore: RiskLevel.LOW,
      idempotencyKey: 'chave-123',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('devolve a transação original sem gravar de novo quando a chave já foi usada', async () => {
      const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
      vi.mocked(transactionRepository.findByIdempotencyKey).mockResolvedValue(existente);

      const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);
      const resultado = await useCase.execute(100, 'BRL', 'chave-123');

      expect(resultado).toEqual(existente);
      expect(transactionRepository.save).not.toHaveBeenCalled();
      expect(mqPublisher.publish).not.toHaveBeenCalled();
      expect(auditRepository.logTransaction).not.toHaveBeenCalled();
    });

    it('grava normalmente quando a chave ainda não foi usada', async () => {
      const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
      vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);
      vi.mocked(transactionRepository.findByIdempotencyKey).mockResolvedValue(null);
      vi.mocked(transactionRepository.save).mockResolvedValue(existente);

      const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);
      await useCase.execute(100, 'BRL', 'chave-123');

      expect(transactionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'chave-123' }),
      );
    });

    it('não consulta a chave quando o cliente não envia nenhuma', async () => {
      const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
      vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);
      vi.mocked(transactionRepository.save).mockResolvedValue(existente);

      const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);
      await useCase.execute(100, 'BRL');

      expect(transactionRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    });

    it('resolve a corrida devolvendo a transação vencedora quando o banco rejeita a duplicata', async () => {
      const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
      vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);
      vi.mocked(transactionRepository.findByIdempotencyKey).mockResolvedValueOnce(null);
      vi.mocked(transactionRepository.save).mockRejectedValue(new DuplicateIdempotencyKeyError('chave-123'));
      vi.mocked(transactionRepository.findByIdempotencyKey).mockResolvedValueOnce(existente);

      const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

      await expect(useCase.execute(100, 'BRL', 'chave-123')).resolves.toEqual(existente);
    });

    it('propaga o erro se a duplicata for detectada mas a transação vencedora sumir', async () => {
      const { transactionRepository, riskStrategy, mqPublisher, auditRepository } = createDeps();
      vi.mocked(riskStrategy.calculateRisk).mockReturnValue(RiskLevel.LOW);
      vi.mocked(transactionRepository.findByIdempotencyKey).mockResolvedValue(null);
      vi.mocked(transactionRepository.save).mockRejectedValue(new DuplicateIdempotencyKeyError('chave-123'));

      const useCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

      await expect(useCase.execute(100, 'BRL', 'chave-123')).rejects.toThrow(DuplicateIdempotencyKeyError);
    });
  });
});

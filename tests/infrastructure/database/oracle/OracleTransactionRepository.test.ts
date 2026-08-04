import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'oracledb';
import { OracleTransactionRepository } from '@/infrastructure/database/oracle/OracleTransactionRepository';
import { RiskLevel } from '@/domain/enums/RiskLevel';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import type { Transaction } from '@/domain/entities/Transaction';
import { DuplicateIdempotencyKeyError } from '@/domain/errors/DuplicateIdempotencyKeyError';

vi.mock('oracledb', () => ({
  default: {
    STRING: 'STRING',
    BIND_OUT: 'BIND_OUT',
  },
}));

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const sampleTransaction: Transaction = {
  id: '',
  amount: 15000,
  currency: 'BRL',
  status: TransactionStatus.PENDING,
  riskScore: RiskLevel.HIGH,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function createFakePool(connection: { execute: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }) {
  return { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
}

describe('OracleTransactionRepository', () => {
  describe('save', () => {
    it('salva a transação e retorna com o ID gerado pelo Oracle', async () => {
      const execute = vi.fn().mockResolvedValue({ outBinds: { outId: ['generated-id-123'] } });
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);
      const result = await repo.save(sampleTransaction);

      expect(result).toEqual({ ...sampleTransaction, id: 'generated-id-123' });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('lança erro quando o Oracle não retorna outBinds', async () => {
      const execute = vi.fn().mockResolvedValue({});
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);

      await expect(repo.save(sampleTransaction)).rejects.toThrow('Oracle não retornou o ID gerado');
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('propaga erro do Oracle e ainda assim fecha a conexão', async () => {
      const dbError = new Error('ORA-00001: unique constraint violated');
      const execute = vi.fn().mockRejectedValue(dbError);
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);

      await expect(repo.save(sampleTransaction)).rejects.toThrow(dbError);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('propaga erro quando falha ao obter conexão do pool', async () => {
      const poolError = new Error('pool esgotado');
      const pool = { getConnection: vi.fn().mockRejectedValue(poolError) } as unknown as Pool;

      const repo = new OracleTransactionRepository(pool);

      await expect(repo.save(sampleTransaction)).rejects.toThrow(poolError);
    });
  });

  describe('findById', () => {
    it('busca e mapeia uma transação existente', async () => {
      const row = {
        ID: 'abc-123',
        AMOUNT: 7500,
        CURRENCY: 'USD',
        STATUS: 'APPROVED',
        RISK_SCORE: RiskLevel.MEDIUM,
        CREATED_AT: new Date('2026-02-01T00:00:00.000Z'),
      };
      const execute = vi.fn().mockResolvedValue({ rows: [row] });
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);
      const result = await repo.findById('abc-123');

      expect(result).toEqual({
        id: 'abc-123',
        amount: 7500,
        currency: 'USD',
        status: 'APPROVED',
        riskScore: RiskLevel.MEDIUM,
        createdAt: row.CREATED_AT,
      });
    });

    it('retorna null quando rows é undefined', async () => {
      const execute = vi.fn().mockResolvedValue({});
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });

    it('retorna null quando rows está vazio', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });

    it('propaga erro de busca e ainda assim fecha a conexão (sem vazamento)', async () => {
      const dbError = new Error('ORA-12154: TNS could not resolve');
      const execute = vi.fn().mockRejectedValue(dbError);
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);

      await expect(repo.findById('abc-123')).rejects.toThrow(dbError);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateStatus', () => {
    it('atualiza o status da transação no Oracle', async () => {
      const execute = vi.fn().mockResolvedValue({ rowsAffected: 1 });
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);
      await repo.updateStatus('abc-123', TransactionStatus.COMPLETED);

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE transactions'),
        { status: TransactionStatus.COMPLETED, id: 'abc-123' },
        { autoCommit: true },
      );
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('propaga erro do Oracle e ainda assim fecha a conexão', async () => {
      const dbError = new Error('ORA-00001: unique constraint violated');
      const execute = vi.fn().mockRejectedValue(dbError);
      const close = vi.fn().mockResolvedValue(undefined);
      const pool = createFakePool({ execute, close });

      const repo = new OracleTransactionRepository(pool);

      await expect(repo.updateStatus('abc-123', TransactionStatus.FAILED)).rejects.toThrow(dbError);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotência', () => {
    it('grava a chave enviada e devolve null na coluna quando não há chave', async () => {
      const execute = vi.fn().mockResolvedValue({ outBinds: { outId: ['id-1'] } });
      const close = vi.fn().mockResolvedValue(undefined);
      const repo = new OracleTransactionRepository(createFakePool({ execute, close }));

      await repo.save({ ...sampleTransaction, idempotencyKey: 'chave-abc' });
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('idempotency_key'),
        expect.objectContaining({ idempotencyKey: 'chave-abc' }),
        { autoCommit: true },
      );

      execute.mockClear();
      await repo.save(sampleTransaction);
      expect(execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ idempotencyKey: null }),
        { autoCommit: true },
      );
    });

    it('traduz ORA-00001 em DuplicateIdempotencyKeyError, sem vazar erro do driver', async () => {
      const oraErro = Object.assign(new Error('ORA-00001: unique constraint violated'), { errorNum: 1 });
      const execute = vi.fn().mockRejectedValue(oraErro);
      const close = vi.fn().mockResolvedValue(undefined);
      const repo = new OracleTransactionRepository(createFakePool({ execute, close }));

      await expect(repo.save({ ...sampleTransaction, idempotencyKey: 'chave-abc' }))
        .rejects.toThrow(DuplicateIdempotencyKeyError);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('não confunde ORA-00001 de outra constraint quando não há chave de idempotência', async () => {
      const oraErro = Object.assign(new Error('ORA-00001: unique constraint violated'), { errorNum: 1 });
      const execute = vi.fn().mockRejectedValue(oraErro);
      const close = vi.fn().mockResolvedValue(undefined);
      const repo = new OracleTransactionRepository(createFakePool({ execute, close }));

      // Sem chave, a violacao veio de outra restricao: deve propagar como esta.
      await expect(repo.save(sampleTransaction)).rejects.toThrow(oraErro);
    });

    it('busca e mapeia a transação pela chave de idempotência', async () => {
      const row = {
        ID: 'tx-1', AMOUNT: 100, CURRENCY: 'BRL',
        STATUS: TransactionStatus.PENDING, RISK_SCORE: RiskLevel.LOW,
        IDEMPOTENCY_KEY: 'chave-abc', CREATED_AT: new Date('2026-02-01T00:00:00.000Z'),
      };
      const execute = vi.fn().mockResolvedValue({ rows: [row] });
      const close = vi.fn().mockResolvedValue(undefined);
      const repo = new OracleTransactionRepository(createFakePool({ execute, close }));

      const result = await repo.findByIdempotencyKey('chave-abc');

      expect(result).toEqual(expect.objectContaining({ id: 'tx-1', idempotencyKey: 'chave-abc' }));
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE idempotency_key = :idempotencyKey'),
        { idempotencyKey: 'chave-abc' },
        { autoCommit: true },
      );
    });

    it('retorna null quando a chave não existe', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const close = vi.fn().mockResolvedValue(undefined);
      const repo = new OracleTransactionRepository(createFakePool({ execute, close }));

      await expect(repo.findByIdempotencyKey('inexistente')).resolves.toBeNull();
    });

    it('retorna null quando rows vem undefined na busca por chave', async () => {
      const execute = vi.fn().mockResolvedValue({});
      const close = vi.fn().mockResolvedValue(undefined);
      const repo = new OracleTransactionRepository(createFakePool({ execute, close }));

      await expect(repo.findByIdempotencyKey('inexistente')).resolves.toBeNull();
    });

    it('propaga erro na busca por chave e ainda fecha a conexão', async () => {
      const dbError = new Error('ORA-12154');
      const execute = vi.fn().mockRejectedValue(dbError);
      const close = vi.fn().mockResolvedValue(undefined);
      const repo = new OracleTransactionRepository(createFakePool({ execute, close }));

      await expect(repo.findByIdempotencyKey('x')).rejects.toThrow(dbError);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});

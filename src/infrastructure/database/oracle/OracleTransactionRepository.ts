import oracledb, { BindParameters } from 'oracledb';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { Transaction } from '@/domain/entities/Transaction';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { DuplicateIdempotencyKeyError } from '@/domain/errors/DuplicateIdempotencyKeyError';
import { logger } from '@/infrastructure/logger/winston.logger';
import { TransactionRowLists } from './TransactionRow';

class OracleTransactionRepository implements ITransactionRepository {
  constructor(private readonly pool: oracledb.Pool) { }

  async save(transaction: Transaction): Promise<Transaction> {
    try {
      const sql = `
        INSERT INTO transactions (amount, currency, status, risk_score, idempotency_key, created_at)
        VALUES (:amount, :currency, :status, :riskScore, :idempotencyKey, :createdAt)
        RETURNING id INTO :outId
      `;

      const params: BindParameters = {
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        riskScore: transaction.riskScore,
        idempotencyKey: transaction.idempotencyKey ?? null,
        createdAt: transaction.createdAt,
        outId: { type: oracledb.STRING, dir: oracledb.BIND_OUT }
      };

      const result = await this.executeQuery<{ outId: string[] }>(sql, params);

      if (!result.outBinds) {
        throw new Error('Oracle não retornou o ID gerado (outBinds ausente)');
      }

      const generatedId = result.outBinds.outId[0];

      return {
        ...transaction,
        id: generatedId
      };

    } catch (error) {
      // ORA-00001 = unique constraint violated. Sob concorrencia, duas requisicoes com
      // a mesma chave podem passar juntas pela verificacao previa; quem garante a
      // unicidade de fato e o indice do banco. Traduzimos aqui para um erro de dominio
      // porque a camada de aplicacao nao deve conhecer codigos de erro do driver.
      if ((error as { errorNum?: number }).errorNum === 1 && transaction.idempotencyKey) {
        throw new DuplicateIdempotencyKeyError(transaction.idempotencyKey);
      }
      logger.error('Erro ao salvar transação no banco de dados Oracle:', error);
      throw error;
    }
  }

  async findById(id: string): Promise<Transaction | null> {
    try {
      const sql = `
        SELECT id, amount, currency, status, risk_score, idempotency_key, created_at
        FROM transactions
        WHERE id = :id
      `;
      const params: BindParameters = { id: id };

      const result = await this.executeQuery<TransactionRowLists>(sql, params);

      if (!result.rows || result.rows.length === 0) {
        return null;
      }

      return this.toTransaction(result.rows[0]);

    } catch (error) {
      logger.error(`Erro ao buscar transação com ID ${id}:`, error);
      throw error;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Transaction | null> {
    try {
      const sql = `
        SELECT id, amount, currency, status, risk_score, idempotency_key, created_at
        FROM transactions
        WHERE idempotency_key = :idempotencyKey
      `;
      const params: BindParameters = { idempotencyKey };

      const result = await this.executeQuery<TransactionRowLists>(sql, params);

      if (!result.rows || result.rows.length === 0) {
        return null;
      }

      return this.toTransaction(result.rows[0]);

    } catch (error) {
      logger.error(`Erro ao buscar transação pela chave de idempotência ${idempotencyKey}:`, error);
      throw error;
    }
  }

  private toTransaction(row: TransactionRowLists): Transaction {
    return {
      id: row.ID,
      amount: row.AMOUNT,
      currency: row.CURRENCY,
      status: row.STATUS,
      riskScore: row.RISK_SCORE,
      idempotencyKey: row.IDEMPOTENCY_KEY ?? undefined,
      createdAt: new Date(row.CREATED_AT)
    };
  }

  async updateStatus(id: string, status: TransactionStatus): Promise<void> {
    try {
      const sql = `
        UPDATE transactions
        SET status = :status
        WHERE id = :id
      `;
      const params: BindParameters = {
        status: status,
        id: id
      };
      await this.executeQuery(sql, params);
    } catch (error) {
      logger.error(`Erro ao atualizar status da transação com ID ${id}:`, error);
      throw error;
    }
  }

  private async executeQuery<T>(query: string, params: BindParameters): Promise<oracledb.Result<T>> {
    let connection: oracledb.Connection | null = null;
    try {
      connection = await this.pool.getConnection();
      return await connection.execute(query, params, {
        autoCommit: true,
      });
    } catch (error) {
      logger.error('Erro interno ao executar query no Oracle:', error);
      throw error;
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }
}

export { OracleTransactionRepository };
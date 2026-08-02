import oracledb, { BindParameters } from 'oracledb';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { Transaction } from '@/domain/entities/Transaction';
import { logger } from '@/infrastructure/logger/winston.logger';
import { TransactionRowLists } from './TransactionRow';

class OracleTransactionRepository implements ITransactionRepository {
  constructor(private readonly pool: oracledb.Pool) { }

  async save(transaction: Transaction): Promise<Transaction> {
    try {
      const sql = `
        INSERT INTO transactions (amount, currency, status, risk_score, created_at)
        VALUES (:amount, :currency, :status, :riskScore, :createdAt)
        RETURNING id INTO :outId
      `;

      const params: BindParameters = {
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        riskScore: transaction.riskScore,
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
      logger.error('Erro ao salvar transação no banco de dados Oracle:', error);
      throw error;
    }
  }

  async findById(id: string): Promise<Transaction | null> {
    try {
      const sql = `
        SELECT id, amount, currency, status, risk_score, created_at
        FROM transactions
        WHERE id = :id
      `;
      const params: BindParameters = { id: id };

      const result = await this.executeQuery<TransactionRowLists>(sql, params);

      if (!result.rows || result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        id: row.ID,
        amount: row.AMOUNT,
        currency: row.CURRENCY,
        status: row.STATUS,
        riskScore: row.RISK_SCORE,
        createdAt: new Date(row.CREATED_AT)
      };

    } catch (error) {
      logger.error(`Erro ao buscar transação com ID ${id}:`, error);
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
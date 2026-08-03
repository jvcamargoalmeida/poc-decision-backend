import type oracledb from 'oracledb';
import { OracleTransactionRepository } from '@/infrastructure/database/oracle/OracleTransactionRepository';
import { AmountRiskStrategy } from '@/domain/strategies/risk/AmountRiskStrategy';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';
import { TransactionController } from '@/presentation/controllers/TransactionController';

function buildTransactionController(pool: oracledb.Pool): TransactionController {
  const transactionRepository = new OracleTransactionRepository(pool);
  const riskStrategy = new AmountRiskStrategy();
  const processTransactionUseCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy);

  return new TransactionController(processTransactionUseCase);
}

export { buildTransactionController };

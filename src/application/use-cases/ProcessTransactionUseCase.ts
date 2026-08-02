import { Transaction } from '@/domain/entities/Transaction';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { IRiskStrategy } from '@/domain/strategies/risk/IRiskStrategy';

class ProcessTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly riskStrategy: IRiskStrategy,
  ) { }

  async execute(amount: number, currency: string): Promise<Transaction> {
    const riskScore = this.riskStrategy.calculateRisk(amount);

    const transaction: Transaction = {
      amount,
      currency,
      status: TransactionStatus.PENDING,
      riskScore,
      createdAt: new Date(),
    };

    return this.transactionRepository.save(transaction);
  }
}

export { ProcessTransactionUseCase };

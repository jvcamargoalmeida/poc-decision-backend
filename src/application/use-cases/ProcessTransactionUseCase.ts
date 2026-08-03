import { Transaction } from '@/domain/entities/Transaction';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { IEventPublisher } from '@/domain/events/IEventPublisher';
import { IAuditRepository } from '@/domain/repositories/IAuditRepository';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { IRiskStrategy } from '@/domain/strategies/risk/IRiskStrategy';

class ProcessTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly riskStrategy: IRiskStrategy,
    private readonly mQPublisher: IEventPublisher,
    private readonly auditRepository: IAuditRepository,
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

    const savedTransaction = await this.transactionRepository.save(transaction);

    if (!savedTransaction.id) throw new Error('Erro ao salvar transação: ID não gerado');

    await this.mQPublisher.publish(`transaction.created`, savedTransaction);
    await this.auditRepository.logTransaction(savedTransaction.id, savedTransaction);

    return savedTransaction;
  }
}

export { ProcessTransactionUseCase };

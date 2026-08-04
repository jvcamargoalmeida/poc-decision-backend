import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { TransactionNotFoundError } from '@/domain/errors/TransactionNotFoundError';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';

class UpdateTransactionStatusUseCase {
  constructor(private readonly transactionRepository: ITransactionRepository) { }

  async execute(id: string, status: TransactionStatus): Promise<void> {
    const transaction = await this.transactionRepository.findById(id);
    if (!transaction) {
      throw new TransactionNotFoundError(id);
    }

    await this.transactionRepository.updateStatus(id, status);
  }
}

export { UpdateTransactionStatusUseCase };

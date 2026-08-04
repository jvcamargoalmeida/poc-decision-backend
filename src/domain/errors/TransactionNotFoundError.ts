import { DomainError } from '@/domain/errors/DomainError';

class TransactionNotFoundError extends DomainError {
  constructor(public readonly transactionId: string) {
    super(`Transação com ID ${transactionId} não encontrada`);
  }
}

export { TransactionNotFoundError };

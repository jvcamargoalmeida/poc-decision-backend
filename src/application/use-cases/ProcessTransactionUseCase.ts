import { Transaction } from '@/domain/entities/Transaction';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { IEventPublisher } from '@/domain/events/IEventPublisher';
import { IAuditRepository } from '@/domain/repositories/IAuditRepository';
import { ITransactionRepository } from '@/domain/repositories/ITransactionRepository';
import { IRiskStrategy } from '@/domain/strategies/risk/IRiskStrategy';
import { DuplicateIdempotencyKeyError } from '@/domain/errors/DuplicateIdempotencyKeyError';
import { logger } from '@/infrastructure/logger/winston.logger';

class ProcessTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly riskStrategy: IRiskStrategy,
    private readonly mQPublisher: IEventPublisher,
    private readonly auditRepository: IAuditRepository,
  ) { }

  async execute(amount: number, currency: string, idempotencyKey?: string): Promise<Transaction> {
    if (idempotencyKey) {
      const jaProcessada = await this.transactionRepository.findByIdempotencyKey(idempotencyKey);
      if (jaProcessada) {
        logger.info('Requisição idempotente: devolvendo transação já existente', {
          transactionId: jaProcessada.id, idempotencyKey,
        });
        return jaProcessada;
      }
    }

    const riskScore = this.riskStrategy.calculateRisk(amount);

    const transaction: Transaction = {
      amount,
      currency,
      status: TransactionStatus.PENDING,
      riskScore,
      idempotencyKey,
      createdAt: new Date(),
    };

    let savedTransaction: Transaction;
    try {
      savedTransaction = await this.transactionRepository.save(transaction);
    } catch (error) {
      if (error instanceof DuplicateIdempotencyKeyError) {
        const vencedora = await this.transactionRepository.findByIdempotencyKey(error.idempotencyKey);
        if (vencedora) {
          logger.info('Corrida de idempotência resolvida: devolvendo a transação vencedora', {
            transactionId: vencedora.id, idempotencyKey: error.idempotencyKey,
          });
          return vencedora;
        }
      }
      throw error;
    }

    if (!savedTransaction.id) throw new Error('Erro ao salvar transação: ID não gerado');

    logger.info('Transação persistida', { transactionId: savedTransaction.id, amount, currency, riskScore });

    const [eventoOk, auditoriaOk] = await Promise.allSettled([
      this.mQPublisher.publish('transaction.created', savedTransaction),
      this.auditRepository.logTransaction(savedTransaction.id, savedTransaction),
    ]);

    if (eventoOk.status === 'rejected') {
      logger.error('Transação persistida mas evento não publicado — decisão não acontecerá', {
        transactionId: savedTransaction.id, error: eventoOk.reason?.message,
      });
    }
    if (auditoriaOk.status === 'rejected') {
      logger.error('Transação persistida mas audit log não gravado', {
        transactionId: savedTransaction.id, error: auditoriaOk.reason?.message,
      });
    }

    return savedTransaction;
  }
}

export { ProcessTransactionUseCase };

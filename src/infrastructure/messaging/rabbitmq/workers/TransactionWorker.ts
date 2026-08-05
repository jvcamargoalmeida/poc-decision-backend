import type { Channel, ConsumeMessage } from 'amqplib';
import { logger } from '@/infrastructure/logger/winston.logger';
import { IDecisionGateway } from '@/domain/services/IDecisionGateway';
import { NonRetryableError, RetryScheduler } from '@/infrastructure/messaging/rabbitmq/retry';
import type { Transaction } from '@/domain/entities/Transaction';

class TransactionWorker {
  private consumerTag: string | null = null;

  constructor(
    private readonly channel: Channel,
    private readonly queue: string,
    private readonly decisionGateway: IDecisionGateway,
    private readonly retryScheduler?: RetryScheduler,
  ) { }

  async start(): Promise<void> {
    const response = await this.channel.consume(this.queue, (message) => this.handleMessage(message));
    this.consumerTag = response.consumerTag;
    logger.info('TransactionWorker listening', { queue: this.queue });
  }

  private async handleMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      return;
    }

    try {
      const transaction = this.parseTransaction(message.content.toString());
      await this.decisionGateway.requestDecision(transaction);
      await this.processTransaction(transaction);
      this.channel.ack(message);
      logger.info('Transaction message processed successfully', { transaction });
    } catch (error) {
      this.rejeitar(message, error as Error);
    }
  }

  private parseTransaction(conteudo: string): Transaction {
    try {
      return JSON.parse(conteudo) as Transaction;
    } catch {
      throw new NonRetryableError('Mensagem de transação com JSON malformado');
    }
  }

  /**
   * Payload malformado é definitivo e vai direto para a fila morta. Falha ao
   * chamar o n8n é transitória por natureza — foi exatamente o `503` sob carga
   * medido no teste de carga —, então ganha nova tentativa com espera crescente
   * em vez de virar mensagem descartada.
   */
  private rejeitar(message: ConsumeMessage, error: Error): void {
    const definitivo = error instanceof NonRetryableError;
    const tentativa = definitivo ? null : this.retryScheduler?.schedule(message) ?? null;

    if (tentativa === null) {
      logger.error('Mensagem de transação descartada para a fila morta', {
        error: error.message,
        motivo: definitivo ? 'erro definitivo' : 'tentativas esgotadas',
      });
      this.channel.nack(message, false, false);
      return;
    }

    logger.warn('Mensagem de transação reagendada após falha transitória', {
      error: error.message,
      tentativa,
      atrasoMs: this.retryScheduler?.delayOf(tentativa),
    });
    this.channel.ack(message);
  }

  async stop(): Promise<void> {
    if (!this.consumerTag) {
      logger.warn('TransactionWorker stop called but no active consumer found');
      return;
    }

    await this.channel.cancel(this.consumerTag);
    this.consumerTag = null;

    logger.info('TransactionWorker stopped', { queue: this.queue });
  }

  private async processTransaction(transaction: unknown): Promise<void> {
    this.channel.publish('amq.topic', 'transaction.processed', Buffer.from(JSON.stringify(transaction)), {
      persistent: true,
      contentType: 'application/json',
    });
  }
}

export { TransactionWorker };

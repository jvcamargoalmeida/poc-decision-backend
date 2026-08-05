import type { Channel, ConsumeMessage } from 'amqplib';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { TransactionNotFoundError } from '@/domain/errors/TransactionNotFoundError';
import { UpdateTransactionStatusUseCase } from '@/application/use-cases/UpdateTransactionStatusUseCase';
import { logger } from '@/infrastructure/logger/winston.logger';

class DecisionResultWorker {
  private consumerTag: string | null = null;

  constructor(
    private readonly channel: Channel,
    private readonly queue: string,
    private readonly updateTransactionStatusUseCase: UpdateTransactionStatusUseCase,
  ) { }

  async start(): Promise<void> {
    const response = await this.channel.consume(this.queue, (message) => this.handleMessage(message));
    this.consumerTag = response.consumerTag;
    logger.info('DecisionResultWorker listening', { queue: this.queue });
  }

  async stop(): Promise<void> {
    if (!this.consumerTag) {
      logger.warn('DecisionResultWorker stop called but no active consumer found');
      return;
    }

    await this.channel.cancel(this.consumerTag);
    this.consumerTag = null;
    logger.info('DecisionResultWorker stopped', { queue: this.queue });
  }

  private async handleMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      return;
    }

    try {
      const decisao = this.parseDecisao(message.content.toString());

      await this.updateTransactionStatusUseCase.execute(decisao.id, decisao.status);

      this.channel.ack(message);
      logger.info('Decisão aplicada à transação', {
        transactionId: decisao.id, status: decisao.status,
      });
    } catch (error) {
      logger.error('Erro ao aplicar decisão vinda da fila', {
        error: (error as Error).message,
        naoRecuperavel: error instanceof TransactionNotFoundError,
      });
      this.channel.nack(message, false, false);
    }
  }

  private parseDecisao(conteudo: string): { id: string; status: TransactionStatus } {
    const payload = JSON.parse(conteudo) as { id?: unknown; status?: unknown };

    if (typeof payload.id !== 'string' || payload.id.length === 0) {
      throw new Error('Decisão sem `id` válido');
    }

    const statusValidos = Object.values(TransactionStatus) as string[];
    if (typeof payload.status !== 'string' || !statusValidos.includes(payload.status)) {
      throw new Error(`Status inválido na decisão: ${String(payload.status)}`);
    }

    return { id: payload.id, status: payload.status as TransactionStatus };
  }
}

export { DecisionResultWorker };

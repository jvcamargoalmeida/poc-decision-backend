import type { Channel, ConsumeMessage } from 'amqplib';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { TransactionNotFoundError } from '@/domain/errors/TransactionNotFoundError';
import { UpdateTransactionStatusUseCase } from '@/application/use-cases/UpdateTransactionStatusUseCase';
import { NonRetryableError, RetryScheduler } from '@/infrastructure/messaging/rabbitmq/retry';
import { logger } from '@/infrastructure/logger/winston.logger';

class DecisionResultWorker {
  private consumerTag: string | null = null;

  constructor(
    private readonly channel: Channel,
    private readonly queue: string,
    private readonly updateTransactionStatusUseCase: UpdateTransactionStatusUseCase,
    private readonly retryScheduler?: RetryScheduler,
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
      this.rejeitar(message, error as Error);
    }
  }

  /**
   * Decide entre reagendar e descartar.
   *
   * Contrato violado e transação inexistente são definitivos: tentar de novo daria
   * exatamente o mesmo resultado, então vão direto para a fila morta. Só falha de
   * infraestrutura — Oracle fora do ar, por exemplo — ganha nova tentativa.
   */
  private rejeitar(message: ConsumeMessage, error: Error): void {
    const definitivo = error instanceof NonRetryableError || error instanceof TransactionNotFoundError;
    const tentativa = definitivo ? null : this.retryScheduler?.schedule(message) ?? null;

    if (tentativa === null) {
      logger.error('Decisão descartada para a fila morta', {
        error: error.message,
        motivo: definitivo ? 'erro definitivo' : 'tentativas esgotadas',
      });
      this.channel.nack(message, false, false);
      return;
    }

    logger.warn('Decisão reagendada após falha transitória', {
      error: error.message,
      tentativa,
      atrasoMs: this.retryScheduler?.delayOf(tentativa),
    });
    this.channel.ack(message);
  }

  private parseDecisao(conteudo: string): { id: string; status: TransactionStatus } {
    let payload: { id?: unknown; status?: unknown };
    try {
      payload = JSON.parse(conteudo) as { id?: unknown; status?: unknown };
    } catch {
      throw new NonRetryableError('Decisão com JSON malformado');
    }

    if (typeof payload.id !== 'string' || payload.id.length === 0) {
      throw new NonRetryableError('Decisão sem `id` válido');
    }

    const statusValidos = Object.values(TransactionStatus) as string[];
    if (typeof payload.status !== 'string' || !statusValidos.includes(payload.status)) {
      throw new NonRetryableError(`Status inválido na decisão: ${String(payload.status)}`);
    }

    return { id: payload.id, status: payload.status as TransactionStatus };
  }
}

export { DecisionResultWorker };

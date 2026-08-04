import type { Channel, ConsumeMessage } from 'amqplib';
import { logger } from '@/infrastructure/logger/winston.logger';
import { IDecisionGateway } from '@/domain/services/IDecisionGateway';

class TransactionWorker {
  private consumerTag: string | null = null;

  constructor(
    private readonly channel: Channel,
    private readonly queue: string,
    private readonly decisionGateway: IDecisionGateway
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
      const content = message.content.toString();
      const transaction = JSON.parse(content);
      await this.decisionGateway.requestDecision(transaction);
      await this.processTransaction(transaction);
      this.channel.ack(message);
      logger.info('Transaction message processed successfully', { transaction });
    } catch (error) {
      logger.error('Error processing transaction message', { error: (error as Error).message });
      this.channel.nack(message, false, false);
    }
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

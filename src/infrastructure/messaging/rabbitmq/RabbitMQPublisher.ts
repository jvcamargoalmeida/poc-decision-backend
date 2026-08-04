import type { Channel } from 'amqplib';
import { IEventPublisher } from '@/domain/events/IEventPublisher';
import { logger } from '@/infrastructure/logger/winston.logger';

class RabbitMQPublisher implements IEventPublisher {
  private readonly exchangeName = 'amq.topic';

  constructor(private readonly channel: Channel) { }

  async publish(event: string, payload: unknown): Promise<void> {
    try {
      const messageBuffer = Buffer.from(
        JSON.stringify({
          eventName: event,
          timestamp: new Date().toISOString(),
          data: payload,
        })
      );

      await this.channel.assertExchange(this.exchangeName, 'topic', { durable: true });

      this.channel.publish(this.exchangeName, event, messageBuffer, {
        persistent: true,
        contentType: 'application/json',
      });

    } catch (error) {
      logger.error('Erro ao publicar evento no RabbitMQ:', error);
      throw error;
    }
  }
}

export { RabbitMQPublisher };

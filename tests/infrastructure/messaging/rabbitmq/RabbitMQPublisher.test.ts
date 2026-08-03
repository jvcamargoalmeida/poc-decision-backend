import { describe, expect, it, vi } from 'vitest';
import type { Channel } from 'amqplib';
import { RabbitMQPublisher } from '@/infrastructure/messaging/rabbitmq/RabbitMQPublisher';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function createFakeChannel() {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockReturnValue(true),
  } as unknown as Channel;
}

describe('RabbitMQPublisher', () => {
  it('declara a exchange e publica o evento serializado em JSON', async () => {
    const channel = createFakeChannel();
    const publisher = new RabbitMQPublisher(channel);

    await publisher.publish('transaction.created', { id: 'tx-id' });

    expect(channel.assertExchange).toHaveBeenCalledWith('amq.topic', 'topic', { durable: true });
    expect(channel.publish).toHaveBeenCalledWith(
      'amq.topic',
      'transaction.created',
      expect.any(Buffer),
      { persistent: true, contentType: 'application/json' },
    );

    const publishedBuffer = vi.mocked(channel.publish).mock.calls[0][2] as Buffer;
    const publishedMessage = JSON.parse(publishedBuffer.toString());
    expect(publishedMessage).toEqual(
      expect.objectContaining({ eventName: 'transaction.created', data: { id: 'tx-id' } }),
    );
  });

  it('propaga o erro quando a publicação falha', async () => {
    const channel = createFakeChannel();
    const publishError = new Error('falha ao publicar no RabbitMQ');
    vi.mocked(channel.assertExchange).mockRejectedValue(publishError);
    const publisher = new RabbitMQPublisher(channel);

    await expect(publisher.publish('transaction.created', { id: 'tx-id' })).rejects.toThrow(publishError);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Channel, ConsumeMessage } from 'amqplib';
import { TransactionWorker } from '@/infrastructure/messaging/rabbitmq/workers/TransactionWorker';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function createFakeChannel() {
  let registeredCallback: ((message: ConsumeMessage | null) => unknown) | undefined;

  const channel = {
    consume: vi.fn((_queue: string, callback: (message: ConsumeMessage | null) => unknown) => {
      registeredCallback = callback;
      return Promise.resolve({ consumerTag: 'fake-consumer' });
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn().mockReturnValue(true),
    cancel: vi.fn().mockResolvedValue(undefined),
  } as unknown as Channel;

  return { channel, getCallback: () => registeredCallback };
}

function createMessage(payload: unknown): ConsumeMessage {
  return { content: Buffer.from(JSON.stringify(payload)) } as ConsumeMessage;
}

describe('TransactionWorker', () => {
  it('registra o listener na fila configurada', async () => {
    const { channel } = createFakeChannel();
    const worker = new TransactionWorker(channel, 'transactions.queue');

    await worker.start();

    expect(channel.consume).toHaveBeenCalledWith('transactions.queue', expect.any(Function));
  });

  it('processa a mensagem, republica como transaction.processed e confirma (ack)', async () => {
    const { channel, getCallback } = createFakeChannel();
    const worker = new TransactionWorker(channel, 'transactions.queue');
    await worker.start();

    const message = createMessage({ id: 'tx-id', amount: 100 });
    await getCallback()?.(message);

    expect(channel.publish).toHaveBeenCalledWith(
      'amq.topic',
      'transaction.processed',
      expect.any(Buffer),
      { persistent: true, contentType: 'application/json' },
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('não faz nada quando a mensagem recebida é null', async () => {
    const { channel, getCallback } = createFakeChannel();
    const worker = new TransactionWorker(channel, 'transactions.queue');
    await worker.start();

    await getCallback()?.(null);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
    expect(channel.publish).not.toHaveBeenCalled();
  });

  it('rejeita (nack, sem requeue) quando a mensagem não é um JSON válido', async () => {
    const { channel, getCallback } = createFakeChannel();
    const worker = new TransactionWorker(channel, 'transactions.queue');
    await worker.start();

    const malformedMessage = { content: Buffer.from('isso nao e json') } as ConsumeMessage;
    await getCallback()?.(malformedMessage);

    expect(channel.nack).toHaveBeenCalledWith(malformedMessage, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('para o consumer com o consumerTag correto quando stop é chamado', async () => {
    const { channel } = createFakeChannel();
    const worker = new TransactionWorker(channel, 'transactions.queue');
    await worker.start();

    await worker.stop();

    expect(channel.cancel).toHaveBeenCalledWith('fake-consumer');
  });

  it('não chama cancel quando stop é chamado sem um consumer ativo', async () => {
    const { channel } = createFakeChannel();
    const worker = new TransactionWorker(channel, 'transactions.queue');

    await worker.stop();

    expect(channel.cancel).not.toHaveBeenCalled();
  });
});

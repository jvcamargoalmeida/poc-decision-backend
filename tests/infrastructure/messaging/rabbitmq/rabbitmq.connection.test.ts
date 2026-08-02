import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();

vi.mock('amqplib', () => ({
  default: { connect: connectMock },
}));

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function createFakeConnection() {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const channelClose = vi.fn().mockResolvedValue(undefined);
  const connectionClose = vi.fn().mockResolvedValue(undefined);
  const channel = { close: channelClose };

  const connection = {
    createChannel: vi.fn().mockResolvedValue(channel),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = handler;
    }),
    close: connectionClose,
  };

  return { connection, channel, listeners, channelClose, connectionClose };
}

describe('rabbitmq.connection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when RABBITMQ_URL is not defined', async () => {
    delete process.env.RABBITMQ_URL;
    const { connectRabbitMQ } = await import('@/infrastructure/messaging/rabbitmq/rabbitmq.connection');

    await expect(connectRabbitMQ()).rejects.toThrow('RABBITMQ_URL is not defined');
  });

  it('throws when getRabbitMQChannel is called before connecting', async () => {
    const { getRabbitMQChannel } = await import('@/infrastructure/messaging/rabbitmq/rabbitmq.connection');

    expect(() => getRabbitMQChannel()).toThrow(
      'RabbitMQ channel not initialized. Call connectRabbitMQ() first.',
    );
  });

  it('connects, creates a channel and registers connection listeners', async () => {
    process.env.RABBITMQ_URL = 'amqp://admin:adminpassword@localhost:5672';
    const { connection, channel, listeners } = createFakeConnection();
    connectMock.mockResolvedValue(connection);

    const { connectRabbitMQ, getRabbitMQChannel } = await import(
      '@/infrastructure/messaging/rabbitmq/rabbitmq.connection'
    );
    const returnedChannel = await connectRabbitMQ();

    expect(returnedChannel).toBe(channel);
    expect(getRabbitMQChannel()).toBe(channel);
    expect(listeners.error).toBeInstanceOf(Function);
    expect(listeners.close).toBeInstanceOf(Function);
    expect(() => listeners.error(new Error('boom'))).not.toThrow();
    expect(() => listeners.close()).not.toThrow();
  });

  it('closes channel and connection, clearing internal state', async () => {
    process.env.RABBITMQ_URL = 'amqp://admin:adminpassword@localhost:5672';
    const { connection, channelClose, connectionClose } = createFakeConnection();
    connectMock.mockResolvedValue(connection);

    const { connectRabbitMQ, closeRabbitMQ, getRabbitMQChannel } = await import(
      '@/infrastructure/messaging/rabbitmq/rabbitmq.connection'
    );
    await connectRabbitMQ();
    await closeRabbitMQ();

    expect(channelClose).toHaveBeenCalledTimes(1);
    expect(connectionClose).toHaveBeenCalledTimes(1);
    expect(() => getRabbitMQChannel()).toThrow();
  });

  it('does nothing when closing before ever connecting', async () => {
    const { closeRabbitMQ } = await import('@/infrastructure/messaging/rabbitmq/rabbitmq.connection');

    await expect(closeRabbitMQ()).resolves.toBeUndefined();
  });
});

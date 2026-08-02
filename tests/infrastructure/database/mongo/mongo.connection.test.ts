import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onMock = vi.fn();
const connectMock = vi.fn();
const disconnectMock = vi.fn();

vi.mock('mongoose', () => ({
  default: {
    connection: { on: onMock },
    connect: connectMock,
    disconnect: disconnectMock,
  },
}));

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe('mongo.connection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    onMock.mockReset();
    connectMock.mockReset();
    disconnectMock.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when MONGO_URI is not defined', async () => {
    delete process.env.MONGO_URI;
    const { connectMongo } = await import('@/infrastructure/database/mongo/mongo.connection');

    await expect(connectMongo()).rejects.toThrow('MONGO_URI is not defined');
  });

  it('connects using MONGO_URI and registers connection listeners', async () => {
    process.env.MONGO_URI = 'mongodb://localhost:27017/transaction_logs';
    connectMock.mockResolvedValue('connected-instance');

    const { connectMongo } = await import('@/infrastructure/database/mongo/mongo.connection');
    const result = await connectMongo();

    expect(result).toBe('connected-instance');
    expect(connectMock).toHaveBeenCalledWith('mongodb://localhost:27017/transaction_logs');
    expect(onMock).toHaveBeenCalledWith('connected', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('disconnected', expect.any(Function));
  });

  it('runs the registered event handlers without throwing', async () => {
    process.env.MONGO_URI = 'mongodb://localhost:27017/transaction_logs';
    connectMock.mockResolvedValue('connected-instance');

    const { connectMongo } = await import('@/infrastructure/database/mongo/mongo.connection');
    await connectMongo();

    const connectedHandler = onMock.mock.calls.find(([event]) => event === 'connected')?.[1];
    const errorHandler = onMock.mock.calls.find(([event]) => event === 'error')?.[1];
    const disconnectedHandler = onMock.mock.calls.find(([event]) => event === 'disconnected')?.[1];

    expect(() => connectedHandler()).not.toThrow();
    expect(() => errorHandler(new Error('connection reset'))).not.toThrow();
    expect(() => disconnectedHandler()).not.toThrow();
  });

  it('disconnects mongoose', async () => {
    disconnectMock.mockResolvedValue(undefined);
    const { disconnectMongo } = await import('@/infrastructure/database/mongo/mongo.connection');

    await disconnectMongo();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createPoolMock = vi.fn();

vi.mock('oracledb', () => ({
  default: {
    OUT_FORMAT_OBJECT: 4002,
    outFormat: undefined,
    autoCommit: undefined,
    createPool: createPoolMock,
  },
}));

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe('oracle.connection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    createPoolMock.mockReset();
    process.env = {
      ...originalEnv,
      ORACLE_USER: 'transaction_app',
      ORACLE_PASSWORD: 'transactionpassword',
      ORACLE_CONNECT_STRING: 'localhost:1521/XEPDB1',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when getOraclePool is called before initOraclePool', async () => {
    const { getOraclePool } = await import('@/infrastructure/database/oracle/oracle.connection');

    expect(() => getOraclePool()).toThrow('Oracle pool not initialized. Call initOraclePool() first.');
  });

  it('creates a pool once and reuses it on subsequent calls', async () => {
    const fakePool = { close: vi.fn().mockResolvedValue(undefined) };
    createPoolMock.mockResolvedValue(fakePool);

    const { initOraclePool, getOraclePool } = await import('@/infrastructure/database/oracle/oracle.connection');

    const pool = await initOraclePool();
    expect(pool).toBe(fakePool);
    expect(getOraclePool()).toBe(fakePool);

    const poolAgain = await initOraclePool();
    expect(poolAgain).toBe(fakePool);
    expect(createPoolMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to default pool sizing when env vars are absent', async () => {
    delete process.env.ORACLE_POOL_MIN;
    delete process.env.ORACLE_POOL_MAX;
    delete process.env.ORACLE_POOL_INCREMENT;
    createPoolMock.mockResolvedValue({ close: vi.fn() });

    const { initOraclePool } = await import('@/infrastructure/database/oracle/oracle.connection');
    await initOraclePool();

    expect(createPoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolMin: 2, poolMax: 10, poolIncrement: 1 }),
    );
  });

  it('honors pool sizing env vars when provided', async () => {
    process.env.ORACLE_POOL_MIN = '5';
    process.env.ORACLE_POOL_MAX = '20';
    process.env.ORACLE_POOL_INCREMENT = '2';
    createPoolMock.mockResolvedValue({ close: vi.fn() });

    const { initOraclePool } = await import('@/infrastructure/database/oracle/oracle.connection');
    await initOraclePool();

    expect(createPoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolMin: 5, poolMax: 20, poolIncrement: 2 }),
    );
  });

  it('closes the pool and clears internal state', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    createPoolMock.mockResolvedValue({ close });

    const { initOraclePool, closeOraclePool, getOraclePool } = await import(
      '@/infrastructure/database/oracle/oracle.connection'
    );

    await initOraclePool();
    await closeOraclePool();

    expect(close).toHaveBeenCalledWith(10);
    expect(() => getOraclePool()).toThrow();
  });

  it('does nothing when closing a pool that was never initialized', async () => {
    const { closeOraclePool } = await import('@/infrastructure/database/oracle/oracle.connection');

    await expect(closeOraclePool()).resolves.toBeUndefined();
    expect(createPoolMock).not.toHaveBeenCalled();
  });
});

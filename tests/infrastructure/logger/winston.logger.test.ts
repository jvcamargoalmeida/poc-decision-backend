import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('winston.logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to info level and identifies the service', async () => {
    delete process.env.LOG_LEVEL;
    const { logger } = await import('@/infrastructure/logger/winston.logger');

    expect(logger.level).toBe('info');
    expect(logger.defaultMeta).toEqual({ service: 'transaction-system' });
  });

  it('respects a custom LOG_LEVEL', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = await import('@/infrastructure/logger/winston.logger');

    expect(logger.level).toBe('debug');
  });

  it('logs through a console transport without throwing', async () => {
    const { logger } = await import('@/infrastructure/logger/winston.logger');

    expect(logger.transports.length).toBeGreaterThan(0);
    expect(() => logger.info('health check')).not.toThrow();
  });
});

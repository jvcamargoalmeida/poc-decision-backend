import Fastify from 'fastify';
import type { Pool } from 'oracledb';
import type { Channel } from 'amqplib';
import type { Connection } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRoutes } from '@/presentation/routes';

const fakePool = {} as Pool;
const fakeChannel = {} as Channel;
const fakeMongoConnection = { model: vi.fn().mockReturnValue(vi.fn()) } as unknown as Connection;

describe('registerRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    await app?.close();
  });

  it('registers the health endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('registers the transactions endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection);

    const response = await app.inject({ method: 'POST', url: '/transactions', payload: {} });

    expect(response.statusCode).toBe(400);
  });

  it('rejeita campos desconhecidos no payload quando removeAdditional está desabilitado (config de produção)', async () => {
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection);

    const response = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { amount: 100, currency: 'BRL', extra: true },
    });

    expect(response.statusCode).toBe(400);
  });
});

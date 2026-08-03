import Fastify from 'fastify';
import type { Pool } from 'oracledb';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRoutes } from '@/presentation/routes';

const fakePool = {} as Pool;

describe('registerRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    await app?.close();
  });

  it('registers the health endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('registers the transactions endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool);

    const response = await app.inject({ method: 'POST', url: '/transactions', payload: {} });

    expect(response.statusCode).toBe(400);
  });

  it('rejeita campos desconhecidos no payload quando removeAdditional está desabilitado (config de produção)', async () => {
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await registerRoutes(app, fakePool);

    const response = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { amount: 100, currency: 'BRL', extra: true },
    });

    expect(response.statusCode).toBe(400);
  });
});

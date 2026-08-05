import Fastify from 'fastify';
import type { Pool } from 'oracledb';
import type { Channel } from 'amqplib';
import type { Connection } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRoutes } from '@/presentation/routes';
import { createBearerAuthHook } from '@/presentation/middlewares/bearer-auth';
import { createRateLimitHook } from '@/presentation/middlewares/rate-limit';
import { errorHandler } from '@/presentation/middlewares/error-handler';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const fakePool = {} as Pool;
const fakeChannel = {} as Channel;
const fakeMongoConnection = { model: vi.fn().mockReturnValue(vi.fn()) } as unknown as Connection;

const CALLBACK_TOKEN = 'token-de-teste';
const authHook = createBearerAuthHook(CALLBACK_TOKEN);
const authHeaders = { authorization: `Bearer ${CALLBACK_TOKEN}` };
const semLimitePratico = () => createRateLimitHook({ max: 10_000, windowMs: 60_000 });

describe('registerRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    await app?.close();
  });

  it('registers the health endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('registers the transactions endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({
      method: 'POST', url: '/transactions', headers: authHeaders, payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejeita campos desconhecidos no payload quando removeAdditional está desabilitado (config de produção)', async () => {
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: authHeaders,
      payload: { amount: 100, currency: 'BRL', extra: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it('registers the callback endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({
      method: 'PATCH',
      url: '/callback/transactions',
      headers: authHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejeita status fora do enum TransactionStatus no callback', async () => {
    app = Fastify();
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({
      method: 'PATCH',
      url: '/callback/transactions',
      headers: authHeaders,
      payload: { id: 'tx-id', status: 'algumacoisa_invalida' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('responde 401 no callback quando não há credencial', async () => {
    app = Fastify();
    app.setErrorHandler(errorHandler);
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({
      method: 'PATCH',
      url: '/callback/transactions',
      payload: { id: 'tx-id', status: 'COMPLETED' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('responde 401 no callback quando a credencial está errada', async () => {
    app = Fastify();
    app.setErrorHandler(errorHandler);
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({
      method: 'PATCH',
      url: '/callback/transactions',
      headers: { authorization: 'Bearer token-errado' },
      payload: { id: 'tx-id', status: 'COMPLETED' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('exige credencial também na rota de transações', async () => {
    app = Fastify();
    app.setErrorHandler(errorHandler);
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, semLimitePratico());

    const response = await app.inject({
      method: 'POST', url: '/transactions', payload: { amount: 100, currency: 'BRL' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('responde 429 quando o limite de requisições é excedido', async () => {
    app = Fastify();
    app.setErrorHandler(errorHandler);
    const limiteBaixo = createRateLimitHook({ max: 2, windowMs: 60_000 });
    await registerRoutes(app, fakePool, fakeChannel, fakeMongoConnection, authHook, authHook, limiteBaixo);

    const chamar = () => app.inject({
      method: 'POST', url: '/transactions', headers: authHeaders, payload: {},
    });

    expect((await chamar()).statusCode).toBe(400);
    expect((await chamar()).statusCode).toBe(400);

    const barrada = await chamar();
    expect(barrada.statusCode).toBe(429);
    expect(barrada.headers['retry-after']).toBeDefined();
  });
});

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRoutes } from '@/presentation/routes';

describe('registerRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    await app?.close();
  });

  it('registers the health endpoint on the Fastify instance', async () => {
    app = Fastify();
    await registerRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });
});

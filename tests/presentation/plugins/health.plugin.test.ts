import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { healthPlugin } from '@/presentation/plugins/health.plugin';

describe('healthPlugin', () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    await app?.close();
  });

  it('responds with status ok and a valid timestamp', async () => {
    app = Fastify();
    await app.register(healthPlugin);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(Number.isNaN(new Date(body.timestamp).getTime())).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRateLimitHook, TooManyRequestsError } from '@/presentation/middlewares/rate-limit';

function createRequest(ip = '10.0.0.1'): FastifyRequest {
  return { ip } as FastifyRequest;
}

function createReply() {
  const headers: Record<string, string> = {};
  const reply = { header: vi.fn((k: string, v: string) => { headers[k] = v; }) };
  return { reply: reply as unknown as FastifyReply, headers };
}

describe('createRateLimitHook', () => {
  it('deixa passar enquanto o limite não é atingido', async () => {
    const hook = createRateLimitHook({ max: 3, windowMs: 60_000 });

    for (let i = 0; i < 3; i += 1) {
      await expect(hook(createRequest(), createReply().reply)).resolves.toBeUndefined();
    }
  });

  it('barra com 429 a requisição que ultrapassa o limite', async () => {
    const hook = createRateLimitHook({ max: 2, windowMs: 60_000 });
    await hook(createRequest(), createReply().reply);
    await hook(createRequest(), createReply().reply);

    await expect(hook(createRequest(), createReply().reply)).rejects.toMatchObject({
      statusCode: 429,
      name: 'TooManyRequestsError',
    });
  });

  it('conta por IP, sem um cliente consumir a cota do outro', async () => {
    const hook = createRateLimitHook({ max: 1, windowMs: 60_000 });

    await expect(hook(createRequest('1.1.1.1'), createReply().reply)).resolves.toBeUndefined();
    await expect(hook(createRequest('2.2.2.2'), createReply().reply)).resolves.toBeUndefined();
    await expect(hook(createRequest('1.1.1.1'), createReply().reply)).rejects.toThrow(TooManyRequestsError);
  });

  it('libera novamente quando a janela expira', async () => {
    let agora = 1_000_000;
    const hook = createRateLimitHook({ max: 1, windowMs: 60_000, now: () => agora });

    await hook(createRequest(), createReply().reply);
    await expect(hook(createRequest(), createReply().reply)).rejects.toThrow(TooManyRequestsError);

    agora += 60_001;

    await expect(hook(createRequest(), createReply().reply)).resolves.toBeUndefined();
  });

  it('expõe os headers de limite e o Retry-After ao barrar', async () => {
    const hook = createRateLimitHook({ max: 1, windowMs: 60_000, now: () => 1_000_000 });
    const permitida = createReply();
    await hook(createRequest(), permitida.reply);

    expect(permitida.headers['X-RateLimit-Limit']).toBe('1');
    expect(permitida.headers['X-RateLimit-Remaining']).toBe('0');
    expect(permitida.headers['X-RateLimit-Reset']).toBeDefined();

    const barrada = createReply();
    await expect(hook(createRequest(), barrada.reply)).rejects.toThrow(TooManyRequestsError);
    expect(barrada.headers['Retry-After']).toBe('60');
  });

  it('não deixa o contador de restantes ficar negativo', async () => {
    const hook = createRateLimitHook({ max: 1, windowMs: 60_000 });
    await hook(createRequest(), createReply().reply);
    await expect(hook(createRequest(), createReply().reply)).rejects.toThrow(TooManyRequestsError);

    const terceira = createReply();
    await expect(hook(createRequest(), terceira.reply)).rejects.toThrow(TooManyRequestsError);
    expect(terceira.headers['X-RateLimit-Remaining']).toBe('0');
  });

  it('varre chaves expiradas para o mapa não crescer sem limite', async () => {
    let agora = 1_000_000;
    const hook = createRateLimitHook({ max: 1, windowMs: 1_000, now: () => agora });

    // Passa do limiar de varredura com IPs distintos e de uso unico.
    for (let i = 0; i < 10_001; i += 1) {
      await hook(createRequest(`10.0.${Math.floor(i / 256)}.${i % 256}`), createReply().reply);
    }

    // Com todas as janelas vencidas, o proximo acesso dispara a varredura e o
    // limite volta a valer normalmente para um IP ja visto.
    agora += 5_000;
    await expect(hook(createRequest('10.0.0.1'), createReply().reply)).resolves.toBeUndefined();
    await expect(hook(createRequest('10.0.0.1'), createReply().reply)).rejects.toThrow(TooManyRequestsError);
  });
});

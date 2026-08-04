import type { FastifyReply, FastifyRequest } from 'fastify';

class TooManyRequestsError extends Error {
  readonly statusCode = 429;

  constructor(message: string) {
    super(message);
    this.name = 'TooManyRequestsError';
  }
}

interface RateLimitOptions {
  /** Requisições permitidas por janela, por cliente. */
  max: number;
  /** Duração da janela em milissegundos. */
  windowMs: number;
  /** Injetável para teste, evitando depender do relógio real. */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Acima deste numero de chaves rastreadas, varremos as expiradas antes de inserir
 * mais. Sem isso o Map cresceria sem limite conforme IPs distintos aparecem, o que
 * seria um vetor de exaustao de memoria — justamente o tipo de problema que um rate
 * limiter deveria evitar, nao criar.
 */
const SWEEP_THRESHOLD = 10_000;

/**
 * Rate limiting por janela fixa, em memória e sem dependência externa.
 *
 * **Limitação assumida:** o estado vive no processo. Com mais de uma instância da
 * API, cada uma aplica seu próprio limite, então o teto efetivo é
 * `max × instâncias`. Para valer de verdade em cluster, o contador precisaria de um
 * store compartilhado (Redis). Para uma PoC de instância única, isto é suficiente e
 * mantém o projeto sem dependências novas.
 *
 * Registrado como `onRequest` — o estágio mais cedo do ciclo do Fastify — para que
 * uma requisição barrada não chegue a pagar parsing de body nem verificação de
 * credencial.
 */
function createRateLimitHook({ max, windowMs, now = Date.now }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  function sweep(current: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) {
        buckets.delete(key);
      }
    }
  }

  return async function rateLimitHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const current = now();
    const key = request.ip;

    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= current) {
      if (buckets.size >= SWEEP_THRESHOLD) {
        sweep(current);
      }
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const restantes = Math.max(0, max - bucket.count);
    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(restantes));
    reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const segundos = Math.ceil((bucket.resetAt - current) / 1000);
      reply.header('Retry-After', String(segundos));
      throw new TooManyRequestsError(`Limite de ${max} requisições por janela excedido`);
    }
  };
}

type RateLimitHook = ReturnType<typeof createRateLimitHook>;

export { createRateLimitHook, TooManyRequestsError, type RateLimitHook, type RateLimitOptions };

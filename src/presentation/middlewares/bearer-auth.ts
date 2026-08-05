import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const BEARER_PREFIX = 'Bearer ';

class UnauthorizedError extends Error {
  readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Compara dois segredos em tempo constante.
 *
 * Os valores são reduzidos a um hash SHA-256 antes da comparação por dois motivos:
 * `timingSafeEqual` lança se os buffers tiverem tamanhos diferentes, e comparar o
 * tamanho antes vazaria o comprimento do segredo pelo tempo de resposta. O hash
 * normaliza tudo para 32 bytes.
 */
function safeCompare(received: string, expected: string): boolean {
  const receivedHash = createHash('sha256').update(received).digest();
  const expectedHash = createHash('sha256').update(expected).digest();

  return timingSafeEqual(receivedHash, expectedHash);
}

/**
 * Cria um hook `preHandler` do Fastify que exige `Authorization: Bearer <token>`.
 *
 * Lança `UnauthorizedError` (statusCode 401) em vez de responder diretamente, para
 * que o `errorHandler` global padronize o corpo da resposta e o log estruturado.
 */
function createBearerAuthHook(expectedToken: string) {
  return async function bearerAuthHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError('Credencial ausente ou em formato inválido');
    }

    const token = header.slice(BEARER_PREFIX.length);

    if (!safeCompare(token, expectedToken)) {
      throw new UnauthorizedError('Credencial inválida');
    }
  };
}

type BearerAuthHook = ReturnType<typeof createBearerAuthHook>;

export { createBearerAuthHook, UnauthorizedError, type BearerAuthHook };

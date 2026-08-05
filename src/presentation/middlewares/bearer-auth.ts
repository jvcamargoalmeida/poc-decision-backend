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

interface ApiClient {
  id: string;
  token: string;
}

/**
 * Lê `API_CLIENTS` no formato `cliente-a:token-a,cliente-b:token-b`.
 *
 * Quando a variável não existe, cai para o `API_AUTH_TOKEN` como um único cliente
 * `default` — a autenticação continua igual, só sem atribuição de identidade. É o
 * que mantém ambientes antigos (e o teste de carga) funcionando sem reconfiguração.
 */
function parseApiClients(raw: string | undefined, fallbackToken: string): ApiClient[] {
  if (!raw) return [{ id: 'default', token: fallbackToken }];

  const clients = raw
    .split(',')
    .map((entrada) => entrada.trim())
    .filter((entrada) => entrada.length > 0)
    .map((entrada) => {
      const separador = entrada.indexOf(':');
      if (separador <= 0) return null;

      const id = entrada.slice(0, separador).trim();
      const token = entrada.slice(separador + 1).trim();

      return id && token ? { id, token } : null;
    })
    .filter((cliente): cliente is ApiClient => cliente !== null);

  return clients.length > 0 ? clients : [{ id: 'default', token: fallbackToken }];
}

/**
 * Hook de autenticação que, além de validar, resolve **qual** cliente chamou e
 * anota o identificador em `request.clientId` para a trilha de auditoria.
 *
 * Percorre a lista inteira mesmo depois de achar o par correto: sair no primeiro
 * acerto faria o tempo de resposta variar com a posição do cliente na lista, o que
 * devolveria pela porta dos fundos o vazamento por *timing* que o `safeCompare`
 * evita.
 */
function createClientAuthHook(clients: ApiClient[]) {
  return async function clientAuthHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError('Credencial ausente ou em formato inválido');
    }

    const token = header.slice(BEARER_PREFIX.length);

    let identificado: string | null = null;
    for (const cliente of clients) {
      if (safeCompare(token, cliente.token)) {
        identificado = cliente.id;
      }
    }

    if (identificado === null) {
      throw new UnauthorizedError('Credencial inválida');
    }

    request.clientId = identificado;
  };
}

type ClientAuthHook = ReturnType<typeof createClientAuthHook>;

export {
  createBearerAuthHook,
  createClientAuthHook,
  parseApiClients,
  UnauthorizedError,
  type ApiClient,
  type BearerAuthHook,
  type ClientAuthHook,
};

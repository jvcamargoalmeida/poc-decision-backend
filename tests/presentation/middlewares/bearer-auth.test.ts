import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createBearerAuthHook,
  createClientAuthHook,
  parseApiClients,
  UnauthorizedError,
} from '@/presentation/middlewares/bearer-auth';

const EXPECTED_TOKEN = 'segredo-super-secreto';

function createRequest(authorization?: string): FastifyRequest {
  return { headers: authorization ? { authorization } : {} } as FastifyRequest;
}

const fakeReply = {} as FastifyReply;

describe('createBearerAuthHook', () => {
  it('deixa passar quando o token confere', async () => {
    const hook = createBearerAuthHook(EXPECTED_TOKEN);

    await expect(hook(createRequest(`Bearer ${EXPECTED_TOKEN}`), fakeReply)).resolves.toBeUndefined();
  });

  it('rejeita quando o header Authorization está ausente', async () => {
    const hook = createBearerAuthHook(EXPECTED_TOKEN);

    await expect(hook(createRequest(), fakeReply)).rejects.toThrow(UnauthorizedError);
  });

  it('rejeita quando o esquema não é Bearer', async () => {
    const hook = createBearerAuthHook(EXPECTED_TOKEN);

    await expect(hook(createRequest(`Basic ${EXPECTED_TOKEN}`), fakeReply)).rejects.toThrow(UnauthorizedError);
  });

  it('rejeita quando o token está errado', async () => {
    const hook = createBearerAuthHook(EXPECTED_TOKEN);

    await expect(hook(createRequest('Bearer token-errado'), fakeReply)).rejects.toThrow('Credencial inválida');
  });

  it('rejeita token de tamanho diferente sem lançar erro de buffer (comparação normalizada por hash)', async () => {
    const hook = createBearerAuthHook(EXPECTED_TOKEN);

    await expect(hook(createRequest('Bearer x'), fakeReply)).rejects.toThrow(UnauthorizedError);
  });

  it('expõe statusCode 401 no erro, para o errorHandler global mapear a resposta', async () => {
    const hook = createBearerAuthHook(EXPECTED_TOKEN);

    await expect(hook(createRequest(), fakeReply)).rejects.toMatchObject({
      statusCode: 401,
      name: 'UnauthorizedError',
    });
  });
});

describe('parseApiClients', () => {
  it('cai para o token único como cliente `default` quando API_CLIENTS não existe', () => {
    expect(parseApiClients(undefined, 'token-unico')).toEqual([{ id: 'default', token: 'token-unico' }]);
  });

  it('lê pares id:token separados por vírgula', () => {
    expect(parseApiClients('parceiro-a:token-a,parceiro-b:token-b', 'ignorado')).toEqual([
      { id: 'parceiro-a', token: 'token-a' },
      { id: 'parceiro-b', token: 'token-b' },
    ]);
  });

  it('tolera espaços em volta das entradas', () => {
    expect(parseApiClients(' parceiro-a : token-a , parceiro-b:token-b ', 'x')).toEqual([
      { id: 'parceiro-a', token: 'token-a' },
      { id: 'parceiro-b', token: 'token-b' },
    ]);
  });

  it('preserva o token que contenha dois-pontos, cortando só no primeiro separador', () => {
    expect(parseApiClients('parceiro:aa:bb:cc', 'x')).toEqual([{ id: 'parceiro', token: 'aa:bb:cc' }]);
  });

  it('descarta entradas sem id ou sem token', () => {
    expect(parseApiClients('parceiro-a:token-a,sem-token:,:sem-id,malformado', 'x')).toEqual([
      { id: 'parceiro-a', token: 'token-a' },
    ]);
  });

  it('cai no fallback quando nenhuma entrada é aproveitável', () => {
    expect(parseApiClients('malformado,,:::', 'token-unico')).toEqual([{ id: 'default', token: 'token-unico' }]);
  });
});

describe('createClientAuthHook', () => {
  const clientes = [
    { id: 'parceiro-a', token: 'token-a' },
    { id: 'parceiro-b', token: 'token-b' },
  ];

  it('resolve a identidade do cliente e anota em request.clientId', async () => {
    const hook = createClientAuthHook(clientes);
    const request = createRequest('Bearer token-b');

    await expect(hook(request, fakeReply)).resolves.toBeUndefined();
    expect(request.clientId).toBe('parceiro-b');
  });

  it('identifica corretamente o primeiro cliente da lista', async () => {
    const hook = createClientAuthHook(clientes);
    const request = createRequest('Bearer token-a');

    await hook(request, fakeReply);

    expect(request.clientId).toBe('parceiro-a');
  });

  it('rejeita token que não pertence a nenhum cliente', async () => {
    const hook = createClientAuthHook(clientes);

    await expect(hook(createRequest('Bearer token-de-ninguem'), fakeReply)).rejects.toThrow(UnauthorizedError);
  });

  it('rejeita quando o header está ausente ou malformado', async () => {
    const hook = createClientAuthHook(clientes);

    await expect(hook(createRequest(), fakeReply)).rejects.toThrow(UnauthorizedError);
    await expect(hook(createRequest('token-a'), fakeReply)).rejects.toThrow(UnauthorizedError);
  });

  it('não deixa a requisição não autenticada herdar identidade', async () => {
    const hook = createClientAuthHook(clientes);
    const request = createRequest('Bearer invalido');

    await expect(hook(request, fakeReply)).rejects.toThrow(UnauthorizedError);
    expect(request.clientId).toBeUndefined();
  });
});

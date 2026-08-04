import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createBearerAuthHook, UnauthorizedError } from '@/presentation/middlewares/bearer-auth';

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

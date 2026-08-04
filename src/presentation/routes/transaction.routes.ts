import type { FastifyInstance } from 'fastify';
import { TransactionController, type CreateTransactionBody } from '@/presentation/controllers/TransactionController';
import type { BearerAuthHook } from '@/presentation/middlewares/bearer-auth';
import type { RateLimitHook } from '@/presentation/middlewares/rate-limit';

const createTransactionSchema = {
  // Opcional e sem `required`: mantem compatibilidade com clientes que nao enviam a
  // chave. Quem envia ganha retry seguro; quem nao envia mantem o comportamento antigo.
  headers: {
    type: 'object',
    properties: {
      'idempotency-key': { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  body: {
    type: 'object',
    required: ['amount', 'currency'],
    additionalProperties: false,
    properties: {
      amount: { type: 'number', exclusiveMinimum: 0 },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
    },
  },
};

export async function registerTransactionRoutes(
  app: FastifyInstance,
  controller: TransactionController,
  authHook: BearerAuthHook,
  rateLimitHook: RateLimitHook,
): Promise<void> {
  // `onRequest` roda antes de `preHandler`: barrar por excesso de requisicoes e
  // mais barato do que verificar credencial, e protege a propria verificacao.
  app.post<{ Body: CreateTransactionBody }>(
    '/transactions',
    { schema: createTransactionSchema, onRequest: rateLimitHook, preHandler: authHook },
    controller.create,
  );
}

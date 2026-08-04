import type { FastifyInstance } from 'fastify';
import { CallbackController, type CallbackBody } from '@/presentation/controllers/CallbackController';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import type { BearerAuthHook } from '@/presentation/middlewares/bearer-auth';
import type { RateLimitHook } from '@/presentation/middlewares/rate-limit';

const callbackTransactionSchema = {
  body: {
    type: 'object',
    required: ['id', 'status'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: Object.values(TransactionStatus) },
    },
  },
};

export async function registerCallbackRoutes(
  app: FastifyInstance,
  controller: CallbackController,
  authHook: BearerAuthHook,
  rateLimitHook: RateLimitHook,
): Promise<void> {
  app.patch<{ Body: CallbackBody }>(
    '/callback/transactions',
    { schema: callbackTransactionSchema, onRequest: rateLimitHook, preHandler: authHook },
    controller.handle,
  );
}

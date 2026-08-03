import type { FastifyInstance } from 'fastify';
import { TransactionController } from '@/presentation/controllers/TransactionController';

const createTransactionSchema = {
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
): Promise<void> {
  app.post('/transactions', { schema: createTransactionSchema }, controller.create);
}

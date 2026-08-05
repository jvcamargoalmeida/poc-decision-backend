import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';

interface CreateTransactionBody {
  amount: number;
  currency: string;
}

export type { CreateTransactionBody };

class TransactionController {
  constructor(private readonly processTransactionUseCase: ProcessTransactionUseCase) { }

  create = async (
    request: FastifyRequest<{ Body: CreateTransactionBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { amount, currency } = request.body;
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const transaction = await this.processTransactionUseCase.execute(
      amount,
      currency,
      idempotencyKey,
      request.clientId,
    );
    await reply.status(201).send(transaction);
  };
}

export { TransactionController };

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';

interface CreateTransactionBody {
  amount: number;
  currency: string;
}

class TransactionController {
  constructor(private readonly processTransactionUseCase: ProcessTransactionUseCase) { }

  create = async (
    request: FastifyRequest<{ Body: CreateTransactionBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { amount, currency } = request.body;
    const transaction = await this.processTransactionUseCase.execute(amount, currency);
    await reply.status(201).send(transaction);
  };
}

export { TransactionController };

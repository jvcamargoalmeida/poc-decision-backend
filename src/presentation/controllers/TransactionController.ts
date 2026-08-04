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
    // Cabecalho padrao de mercado (mesma convencao do Stripe). Precisa vir do cliente:
    // se o servidor gerasse a chave, um retry geraria outra e duplicaria a transacao.
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const transaction = await this.processTransactionUseCase.execute(amount, currency, idempotencyKey);
    await reply.status(201).send(transaction);
  };
}

export { TransactionController };

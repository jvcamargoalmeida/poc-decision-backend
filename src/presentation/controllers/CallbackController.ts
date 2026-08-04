import type { FastifyReply, FastifyRequest } from 'fastify';
import { UpdateTransactionStatusUseCase } from '@/application/use-cases/UpdateTransactionStatusUseCase';
import { TransactionNotFoundError } from '@/domain/errors/TransactionNotFoundError';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { logger } from '@/infrastructure/logger/winston.logger';

interface CallbackBody {
  id: string;
  status: TransactionStatus;
}

export type { CallbackBody };

class CallbackController {
  constructor(private readonly updateTransactionStatusUseCase: UpdateTransactionStatusUseCase) { }

  handle = async (
    request: FastifyRequest<{ Body: CallbackBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { id, status } = request.body;

    try {
      await this.updateTransactionStatusUseCase.execute(id, status);
      reply.status(200).send({ message: 'Callback processed successfully' });
    } catch (error) {
      if (error instanceof TransactionNotFoundError) {
        reply.status(404).send({ message: error.message });
        return;
      }

      logger.error('Erro ao processar callback do n8n:', error);
      reply.status(500).send({ message: 'Error processing callback' });
    }
  };
}

export { CallbackController };
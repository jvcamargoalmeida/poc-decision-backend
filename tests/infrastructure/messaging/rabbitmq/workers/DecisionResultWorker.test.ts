import { describe, expect, it, vi } from 'vitest';
import type { Channel, ConsumeMessage } from 'amqplib';
import { DecisionResultWorker } from '@/infrastructure/messaging/rabbitmq/workers/DecisionResultWorker';
import { UpdateTransactionStatusUseCase } from '@/application/use-cases/UpdateTransactionStatusUseCase';
import { TransactionNotFoundError } from '@/domain/errors/TransactionNotFoundError';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function createFakeChannel() {
  let registeredCallback: ((message: ConsumeMessage | null) => unknown) | undefined;

  const channel = {
    consume: vi.fn((_q: string, cb: (m: ConsumeMessage | null) => unknown) => {
      registeredCallback = cb;
      return Promise.resolve({ consumerTag: 'fake-consumer' });
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  } as unknown as Channel;

  return { channel, getCallback: () => registeredCallback };
}

function createUseCase() {
  return { execute: vi.fn().mockResolvedValue(undefined) } as unknown as UpdateTransactionStatusUseCase;
}

function msg(payload: unknown): ConsumeMessage {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { content: Buffer.from(raw) } as ConsumeMessage;
}

const FILA = 'transactions.queue.decision.results';

describe('DecisionResultWorker', () => {
  it('registra o listener na fila de resultados', async () => {
    const { channel } = createFakeChannel();
    const worker = new DecisionResultWorker(channel, FILA, createUseCase());

    await worker.start();

    expect(channel.consume).toHaveBeenCalledWith(FILA, expect.any(Function));
  });

  it('aplica a decisão e confirma a mensagem', async () => {
    const { channel, getCallback } = createFakeChannel();
    const useCase = createUseCase();
    const worker = new DecisionResultWorker(channel, FILA, useCase);
    await worker.start();

    const mensagem = msg({ id: 'tx-1', status: 'COMPLETED' });
    await getCallback()?.(mensagem);

    expect(useCase.execute).toHaveBeenCalledWith('tx-1', TransactionStatus.COMPLETED);
    expect(channel.ack).toHaveBeenCalledWith(mensagem);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('ignora mensagem null', async () => {
    const { channel, getCallback } = createFakeChannel();
    const useCase = createUseCase();
    const worker = new DecisionResultWorker(channel, FILA, useCase);
    await worker.start();

    await getCallback()?.(null);

    expect(useCase.execute).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('rejeita status fora do enum sem tocar no banco', async () => {
    const { channel, getCallback } = createFakeChannel();
    const useCase = createUseCase();
    const worker = new DecisionResultWorker(channel, FILA, useCase);
    await worker.start();

    const mensagem = msg({ id: 'tx-1', status: 'APROVADO' });
    await getCallback()?.(mensagem);

    expect(useCase.execute).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(mensagem, false, false);
  });

  it('rejeita mensagem sem id válido', async () => {
    const { channel, getCallback } = createFakeChannel();
    const useCase = createUseCase();
    const worker = new DecisionResultWorker(channel, FILA, useCase);
    await worker.start();

    const mensagem = msg({ status: 'COMPLETED' });
    await getCallback()?.(mensagem);

    expect(useCase.execute).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(mensagem, false, false);
  });

  it('rejeita JSON malformado', async () => {
    const { channel, getCallback } = createFakeChannel();
    const worker = new DecisionResultWorker(channel, FILA, createUseCase());
    await worker.start();

    const mensagem = msg('isso nao e json');
    await getCallback()?.(mensagem);

    expect(channel.nack).toHaveBeenCalledWith(mensagem, false, false);
  });

  it('rejeita sem requeue quando a transação não existe — retry não resolveria', async () => {
    const { channel, getCallback } = createFakeChannel();
    const useCase = createUseCase();
    vi.mocked(useCase.execute).mockRejectedValue(new TransactionNotFoundError('tx-sumiu'));
    const worker = new DecisionResultWorker(channel, FILA, useCase);
    await worker.start();

    const mensagem = msg({ id: 'tx-sumiu', status: 'COMPLETED' });
    await getCallback()?.(mensagem);

    expect(channel.nack).toHaveBeenCalledWith(mensagem, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('para o consumer com o consumerTag correto', async () => {
    const { channel } = createFakeChannel();
    const worker = new DecisionResultWorker(channel, FILA, createUseCase());
    await worker.start();

    await worker.stop();

    expect(channel.cancel).toHaveBeenCalledWith('fake-consumer');
  });

  it('não chama cancel quando não há consumer ativo', async () => {
    const { channel } = createFakeChannel();
    const worker = new DecisionResultWorker(channel, FILA, createUseCase());

    await worker.stop();

    expect(channel.cancel).not.toHaveBeenCalled();
  });
});

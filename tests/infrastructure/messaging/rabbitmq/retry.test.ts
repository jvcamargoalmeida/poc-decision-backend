import { describe, expect, it, vi } from 'vitest';
import type { Channel, ConsumeMessage } from 'amqplib';
import {
  ATTEMPT_HEADER,
  DEFAULT_RETRY_DELAYS_MS,
  NonRetryableError,
  RetryScheduler,
  assertRetryTopology,
  parseRetryDelays,
  retryQueueName,
} from '@/infrastructure/messaging/rabbitmq/retry';

function createFakeChannel() {
  return {
    assertQueue: vi.fn().mockResolvedValue(undefined),
    sendToQueue: vi.fn().mockReturnValue(true),
  } as unknown as Channel;
}

function msg(headers: Record<string, unknown> = {}, conteudo = '{"id":"tx-1"}'): ConsumeMessage {
  return {
    content: Buffer.from(conteudo),
    properties: { headers, contentType: 'application/json' },
  } as unknown as ConsumeMessage;
}

const FILA = 'transactions.queue';

describe('retryQueueName', () => {
  it('numera os níveis a partir de 1, para o nome bater com a tentativa', () => {
    expect(retryQueueName(FILA, 0)).toBe('transactions.queue.retry.1');
    expect(retryQueueName(FILA, 2)).toBe('transactions.queue.retry.3');
  });
});

describe('parseRetryDelays', () => {
  it('usa o padrão quando a variável não existe', () => {
    expect(parseRetryDelays(undefined)).toEqual(DEFAULT_RETRY_DELAYS_MS);
  });

  it('lê a lista separada por vírgula, tolerando espaços', () => {
    expect(parseRetryDelays('1000, 2000 ,3000')).toEqual([1000, 2000, 3000]);
  });

  it('descarta valores não numéricos ou não positivos', () => {
    expect(parseRetryDelays('1000,abc,-5,0,2000')).toEqual([1000, 2000]);
  });

  it('cai no padrão quando nada sobra — variável mal preenchida não desliga o retry', () => {
    expect(parseRetryDelays('abc,-1')).toEqual(DEFAULT_RETRY_DELAYS_MS);
    expect(parseRetryDelays('')).toEqual(DEFAULT_RETRY_DELAYS_MS);
  });
});

describe('assertRetryTopology', () => {
  it('declara uma fila por nível, com TTL próprio e retorno para a fila de origem', async () => {
    const channel = createFakeChannel();

    await assertRetryTopology(channel, FILA, [5_000, 30_000]);

    expect(channel.assertQueue).toHaveBeenCalledTimes(2);
    expect(channel.assertQueue).toHaveBeenNthCalledWith(1, 'transactions.queue.retry.1', {
      durable: true,
      messageTtl: 5_000,
      deadLetterExchange: '',
      deadLetterRoutingKey: FILA,
    });
    expect(channel.assertQueue).toHaveBeenNthCalledWith(2, 'transactions.queue.retry.2', {
      durable: true,
      messageTtl: 30_000,
      deadLetterExchange: '',
      deadLetterRoutingKey: FILA,
    });
  });

  it('devolve pela exchange padrão, não pela topic — senão reentregaria a toda fila ligada à routing key', async () => {
    const channel = createFakeChannel();

    await assertRetryTopology(channel, FILA, [1_000]);

    expect(channel.assertQueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ deadLetterExchange: '', deadLetterRoutingKey: FILA }),
    );
  });

  it('usa os atrasos padrão quando nenhum é informado', async () => {
    const channel = createFakeChannel();

    await assertRetryTopology(channel, FILA);

    expect(channel.assertQueue).toHaveBeenCalledTimes(DEFAULT_RETRY_DELAYS_MS.length);
  });

  it('traduz o 406 do broker em instrução acionável, em vez de vazar o erro do driver', async () => {
    const channel = createFakeChannel();
    vi.mocked(channel.assertQueue).mockRejectedValue(
      Object.assign(new Error('PRECONDITION_FAILED - inequivalent arg'), { code: 406 }),
    );

    await expect(assertRetryTopology(channel, FILA, [5_000])).rejects.toThrow(
      /já existe com atraso diferente.*rabbitmqctl delete_queue transactions\.queue\.retry\.1/s,
    );
  });

  it('propaga erro que não seja 406 sem mascarar a causa', async () => {
    const channel = createFakeChannel();
    const falhaDeRede = new Error('conexão perdida');
    vi.mocked(channel.assertQueue).mockRejectedValue(falhaDeRede);

    await expect(assertRetryTopology(channel, FILA, [5_000])).rejects.toThrow(falhaDeRede);
  });
});

describe('RetryScheduler', () => {
  it('expõe o número máximo de tentativas a partir dos atrasos configurados', () => {
    expect(new RetryScheduler(createFakeChannel(), FILA, [1, 2, 3]).maxAttempts).toBe(3);
  });

  it('trata mensagem sem header como tentativa zero', () => {
    const scheduler = new RetryScheduler(createFakeChannel(), FILA, [1_000]);

    expect(scheduler.attemptOf(msg())).toBe(0);
    expect(scheduler.attemptOf(msg({ [ATTEMPT_HEADER]: 2 }))).toBe(2);
  });

  it('ignora header corrompido em vez de confiar nele', () => {
    const scheduler = new RetryScheduler(createFakeChannel(), FILA, [1_000]);

    expect(scheduler.attemptOf(msg({ [ATTEMPT_HEADER]: 'muitas' }))).toBe(0);
    expect(scheduler.attemptOf(msg({ [ATTEMPT_HEADER]: -3 }))).toBe(0);
  });

  it('republica na fila do nível atual e incrementa o contador', () => {
    const channel = createFakeChannel();
    const scheduler = new RetryScheduler(channel, FILA, [5_000, 30_000]);
    const mensagem = msg();

    const tentativa = scheduler.schedule(mensagem);

    expect(tentativa).toBe(1);
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'transactions.queue.retry.1',
      mensagem.content,
      expect.objectContaining({
        persistent: true,
        headers: expect.objectContaining({ [ATTEMPT_HEADER]: 1 }),
      }),
    );
  });

  it('escala para a fila do próximo nível na tentativa seguinte', () => {
    const channel = createFakeChannel();
    const scheduler = new RetryScheduler(channel, FILA, [5_000, 30_000, 120_000]);

    expect(scheduler.schedule(msg({ [ATTEMPT_HEADER]: 1 }))).toBe(2);
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'transactions.queue.retry.2',
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ [ATTEMPT_HEADER]: 2 }) }),
    );
  });

  it('preserva headers originais ao reagendar', () => {
    const channel = createFakeChannel();
    const scheduler = new RetryScheduler(channel, FILA, [1_000]);

    scheduler.schedule(msg({ 'x-origem': 'teste' }));

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-origem': 'teste' }) }),
    );
  });

  it('devolve null quando o orçamento de tentativas acaba, sem republicar', () => {
    const channel = createFakeChannel();
    const scheduler = new RetryScheduler(channel, FILA, [5_000, 30_000]);

    expect(scheduler.schedule(msg({ [ATTEMPT_HEADER]: 2 }))).toBeNull();
    expect(channel.sendToQueue).not.toHaveBeenCalled();
  });

  it('informa o atraso de cada tentativa, para o log dizer quanto vai esperar', () => {
    const scheduler = new RetryScheduler(createFakeChannel(), FILA, [5_000, 30_000]);

    expect(scheduler.delayOf(1)).toBe(5_000);
    expect(scheduler.delayOf(2)).toBe(30_000);
    expect(scheduler.delayOf(3)).toBeUndefined();
  });

  it('usa os atrasos padrão quando nenhum é informado', () => {
    expect(new RetryScheduler(createFakeChannel(), FILA).maxAttempts).toBe(DEFAULT_RETRY_DELAYS_MS.length);
  });
});

describe('NonRetryableError', () => {
  it('é distinguível de um erro comum, que é o que decide entre reagendar e descartar', () => {
    const erro = new NonRetryableError('contrato violado');

    expect(erro).toBeInstanceOf(Error);
    expect(erro.name).toBe('NonRetryableError');
    expect(new Error('falha de rede')).not.toBeInstanceOf(NonRetryableError);
  });
});

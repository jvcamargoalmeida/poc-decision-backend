import type { Channel, ConsumeMessage } from 'amqplib';

const ATTEMPT_HEADER = 'x-attempt';

const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/**
 * Erro que não adianta tentar de novo: payload malformado, contrato violado,
 * transação inexistente. Repetir só gastaria o orçamento de tentativas para
 * chegar no mesmo lugar, então o worker manda direto para a fila morta.
 */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

function retryQueueName(sourceQueue: string, level: number): string {
  return `${sourceQueue}.retry.${level + 1}`;
}

/**
 * Declara uma fila de espera por nível de backoff.
 *
 * Cada fila é deliberadamente **sem consumidor**: a mensagem fica parada até o
 * `x-message-ttl` expirar e o próprio broker a devolver para a fila de origem.
 * É o RabbitMQ fazendo o papel de agendador, sem timer na aplicação — se o
 * processo cair no meio da espera, a mensagem continua lá.
 *
 * O retorno é feito pela exchange padrão (`''`) com routing key igual ao nome da
 * fila de origem, e não pela `amq.topic`: voltar pela topic entregaria a mensagem
 * a **toda** fila ligada àquela routing key, não só à que falhou.
 *
 * Um nível por atraso, em vez de uma fila só com TTL variável por mensagem,
 * porque a expiração numa fila é avaliada na cabeça: uma mensagem de 120s na
 * frente seguraria as de 5s atrás dela.
 */
async function assertRetryTopology(
  channel: Channel,
  sourceQueue: string,
  delaysMs: number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<void> {
  for (let level = 0; level < delaysMs.length; level += 1) {
    const queue = retryQueueName(sourceQueue, level);

    try {
      await channel.assertQueue(queue, {
        durable: true,
        messageTtl: delaysMs[level],
        deadLetterExchange: '',
        deadLetterRoutingKey: sourceQueue,
      });
    } catch (error) {
      // O RabbitMQ recusa redeclarar fila com argumento diferente do vigente, e o
      // erro cru do driver não diz o que fazer. Mudar RETRY_DELAYS_MS num ambiente
      // que já subiu cai exatamente aqui.
      if ((error as { code?: number }).code === 406) {
        throw new Error(
          `Fila de retry '${queue}' já existe com atraso diferente do configurado (${delaysMs[level]}ms). ` +
          `O RabbitMQ não altera argumento de fila existente. Apague-a uma vez e suba de novo: ` +
          `docker compose exec rabbitmq rabbitmqctl delete_queue ${queue}`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

/**
 * Lê a configuração de atrasos de uma string `5000,30000,120000`.
 * Valor ausente ou inválido cai no padrão, para uma variável mal preenchida não
 * desligar o retry silenciosamente.
 */
function parseRetryDelays(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_RETRY_DELAYS_MS;

  const delays = raw
    .split(',')
    .map((valor) => Number(valor.trim()))
    .filter((valor) => Number.isFinite(valor) && valor > 0);

  return delays.length > 0 ? delays : DEFAULT_RETRY_DELAYS_MS;
}

class RetryScheduler {
  constructor(
    private readonly channel: Channel,
    private readonly sourceQueue: string,
    private readonly delaysMs: number[] = DEFAULT_RETRY_DELAYS_MS,
  ) { }

  get maxAttempts(): number {
    return this.delaysMs.length;
  }

  attemptOf(message: ConsumeMessage): number {
    const bruto = message.properties.headers?.[ATTEMPT_HEADER];
    return typeof bruto === 'number' && bruto > 0 ? bruto : 0;
  }

  /**
   * Republica a mensagem na fila de espera do nível atual e devolve o número da
   * tentativa agendada. Devolve `null` quando o orçamento acabou — aí cabe ao
   * chamador rejeitar para a fila morta.
   *
   * A cópia agendada substitui a original, que o worker confirma em seguida.
   * A janela entre republicar e confirmar é o preço do *at-least-once*: uma queda
   * exatamente ali duplica a mensagem, o que é preferível a perdê-la.
   */
  schedule(message: ConsumeMessage): number | null {
    const tentativaAtual = this.attemptOf(message);
    if (tentativaAtual >= this.delaysMs.length) return null;

    const proximaTentativa = tentativaAtual + 1;

    this.channel.sendToQueue(retryQueueName(this.sourceQueue, tentativaAtual), message.content, {
      persistent: true,
      contentType: message.properties.contentType,
      headers: { ...message.properties.headers, [ATTEMPT_HEADER]: proximaTentativa },
    });

    return proximaTentativa;
  }

  delayOf(attempt: number): number | undefined {
    return this.delaysMs[attempt - 1];
  }
}

export {
  ATTEMPT_HEADER,
  DEFAULT_RETRY_DELAYS_MS,
  NonRetryableError,
  RetryScheduler,
  assertRetryTopology,
  parseRetryDelays,
  retryQueueName,
};

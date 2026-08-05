import { logger } from '@/infrastructure/logger/winston.logger';

interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
}

interface GracefulShutdownOptions {
  /** Executados em ordem. Coloque primeiro o que para de aceitar trabalho novo. */
  steps: ShutdownStep[];
  /** Tempo máximo para o encerramento completo antes de forçar a saída. */
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  /** Injetável para teste; por padrão encerra o processo. */
  exit?: (code: number) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Registra o encerramento gracioso da aplicação em resposta a sinais do sistema.
 *
 * `SIGTERM` é o que `docker stop` e orquestradores (Kubernetes) enviam antes de
 * matar o processo; `SIGINT` é o `Ctrl+C`. Sem isso, o processo morre no meio de
 * requisições e deixa conexões penduradas do lado do Oracle/Mongo/RabbitMQ até
 * que eles próprios detectem a queda.
 *
 * Um passo que falha **não** aborta os seguintes — é preferível tentar fechar
 * todo o resto e sair com código 1 do que vazar conexões por causa de um recurso
 * problemático.
 *
 * @returns o handler de encerramento, para permitir acioná-lo diretamente em testes.
 */
function registerGracefulShutdown({
  steps,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signals = DEFAULT_SIGNALS,
  exit = (code) => process.exit(code),
}: GracefulShutdownOptions): (signal: string) => Promise<void> {
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      logger.warn('Encerramento já em andamento, sinal ignorado', { signal });
      return;
    }
    shuttingDown = true;

    logger.info('Encerrando aplicação', { signal });

    const forceTimer = setTimeout(() => {
      logger.error('Timeout no encerramento, forçando saída', { timeoutMs });
      exit(1);
    }, timeoutMs);
    forceTimer.unref();

    let failed = false;

    for (const step of steps) {
      try {
        await step.run();
        logger.info('Recurso encerrado', { step: step.name });
      } catch (error) {
        failed = true;
        logger.error('Falha ao encerrar recurso', {
          step: step.name,
          error: (error as Error).message,
        });
      }
    }

    clearTimeout(forceTimer);
    logger.info('Encerramento concluído', { signal, failed });

    exit(failed ? 1 : 0);
  }

  for (const signal of signals) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  return shutdown;
}

export { registerGracefulShutdown, type ShutdownStep, type GracefulShutdownOptions };

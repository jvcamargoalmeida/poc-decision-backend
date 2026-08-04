import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdown } from '@/infrastructure/lifecycle/graceful-shutdown';

vi.mock('@/infrastructure/logger/winston.logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Cada registro adiciona listeners reais ao processo; sem a limpeza o Node emite
// MaxListenersExceededWarning conforme os testes se acumulam.
afterEach(() => {
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGUSR2');
  vi.useRealTimers();
});

describe('registerGracefulShutdown', () => {
  it('executa os passos na ordem declarada e sai com código 0', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = registerGracefulShutdown({
      exit,
      steps: [
        { name: 'http', run: async () => { order.push('http'); } },
        { name: 'worker', run: async () => { order.push('worker'); } },
        { name: 'db', run: async () => { order.push('db'); } },
      ],
    });

    await shutdown('SIGTERM');

    expect(order).toEqual(['http', 'worker', 'db']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('continua encerrando os demais recursos quando um passo falha, e sai com código 1', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = registerGracefulShutdown({
      exit,
      steps: [
        { name: 'http', run: async () => { order.push('http'); } },
        { name: 'worker', run: async () => { throw new Error('worker travado'); } },
        { name: 'db', run: async () => { order.push('db'); } },
      ],
    });

    await shutdown('SIGTERM');

    expect(order).toEqual(['http', 'db']);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('ignora sinais repetidos enquanto um encerramento já está em andamento', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = registerGracefulShutdown({ exit, steps: [{ name: 'db', run }] });

    await shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(run).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('força a saída quando o encerramento estoura o timeout', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    let liberarPasso: (() => void) | undefined;

    const shutdown = registerGracefulShutdown({
      exit,
      timeoutMs: 5_000,
      steps: [{ name: 'travado', run: () => new Promise<void>((resolve) => { liberarPasso = resolve; }) }],
    });

    const encerrando = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(exit).toHaveBeenCalledWith(1);

    liberarPasso?.();
    await encerrando;
  });

  it('encerra o processo via process.exit quando nenhum exit é injetado', async () => {
    // process.exit precisa estar mockado: sem isso, o encerramento derrubaria o
    // próprio runner de testes.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const shutdown = registerGracefulShutdown({
      steps: [{ name: 'db', run: vi.fn().mockResolvedValue(undefined) }],
    });

    await shutdown('SIGTERM');

    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('aciona o encerramento ao receber o sinal registrado no processo', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    registerGracefulShutdown({ exit, steps: [{ name: 'db', run }], signals: ['SIGUSR2'] });

    process.emit('SIGUSR2');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(run).toHaveBeenCalledTimes(1);
  });
});

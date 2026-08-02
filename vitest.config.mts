import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // server.ts e um bootstrap fino (chama app.listen/process.exit) sem
      // valor de teste unitario; entra em coverage assim que ganhar logica.
      exclude: ['src/server.ts', 'src/**/*.d.ts'],
      // Gate de merge (CLAUDE.md); mantenha sincronizado com MIN_COVERAGE
      // em .github/workflows/ci.yml
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});

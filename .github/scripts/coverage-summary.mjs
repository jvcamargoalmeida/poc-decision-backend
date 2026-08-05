#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MARKER = '<!-- vitest-coverage-report -->';
const COVERAGE_SUMMARY_PATH = 'coverage/coverage-summary.json';
const METRICS = ['statements', 'branches', 'functions', 'lines'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function metricRow(label, metric, minCoverage) {
  if (!metric) {
    return `| ${label} | - | - | - |`;
  }
  const status = metric.pct >= minCoverage ? '✅' : '❌';
  return `| ${label} | ${metric.covered}/${metric.total} | ${metric.pct.toFixed(2)}% | ${status} |`;
}

function buildReport(minCoverage) {
  if (!existsSync(COVERAGE_SUMMARY_PATH)) {
    return {
      passed: false,
      markdown: [
        MARKER,
        '### 🧪 Cobertura de testes',
        '',
        `> ⚠️ Não foi possível encontrar o relatório de cobertura (\`${COVERAGE_SUMMARY_PATH}\`). Verifique se os testes rodaram com sucesso.`,
      ].join('\n'),
    };
  }

  const summary = JSON.parse(readFileSync(COVERAGE_SUMMARY_PATH, 'utf8'));
  const total = summary.total;

  const rows = METRICS.map((key) =>
    metricRow(key[0].toUpperCase() + key.slice(1), total[key], minCoverage),
  );
  const passed = METRICS.every((key) => total[key].pct >= minCoverage);

  const markdown = [
    MARKER,
    `### 🧪 Cobertura de testes (mínimo exigido: ${minCoverage}%)`,
    '',
    '| Métrica | Cobertos | % | Status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    passed
      ? `✅ Cobertura acima do mínimo exigido (${minCoverage}%).`
      : `❌ Cobertura abaixo do mínimo exigido (${minCoverage}%). Esta PR não pode ser mergeada até o código novo/alterado ser coberto por testes.`,
  ].join('\n');

  return { passed, markdown };
}

const args = parseArgs(process.argv.slice(2));
const minCoverage = Number(args['min-coverage'] ?? 95);
const { passed, markdown } = buildReport(minCoverage);

if (args.summary) {
  writeFileSync(args.summary, `${markdown}\n`, { flag: 'a' });
}

if (args.out) {
  writeFileSync(args.out, markdown);
}

if (!passed) {
  console.warn(`Cobertura abaixo do minimo exigido de ${minCoverage}%.`);
}

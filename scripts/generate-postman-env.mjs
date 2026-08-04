#!/usr/bin/env node
/**
 * Gera um Postman Environment a partir do `.env` local.
 *
 * Existe porque o Postman não lê o filesystem: nem ao importar uma collection, nem
 * de dentro de um pre-request script (o sandbox não expõe `fs`). Então a única
 * forma de levar o segredo do `.env` para o Postman é materializar um arquivo de
 * environment e importá-lo.
 *
 * O arquivo gerado **contém o segredo** e por isso é ignorado pelo git.
 *
 * Uso: npm run postman:env
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const outPath = resolve(root, 'poc_decision_backend.postman_environment.json');

if (!existsSync(envPath)) {
  console.error('Erro: .env não encontrado. Rode `cp .env.example .env` e preencha os valores.');
  process.exit(1);
}

/** Parse mínimo de .env: ignora comentários e linhas vazias, tira aspas ao redor. */
function parseEnv(content) {
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    vars[key] = value;
  }
  return vars;
}

const env = parseEnv(readFileSync(envPath, 'utf8'));

/** Deriva a origem (scheme://host:port) de uma URL completa, descartando o path. */
function origin(url, fallback) {
  try {
    return new URL(url).origin;
  } catch {
    return fallback;
  }
}

const apiUrl = `http://localhost:${env.PORT || '3000'}`;
const n8nUrl = origin(env.N8N_WEBHOOK_URL, 'http://localhost:5678');
const token = env.CALLBACK_AUTH_TOKEN || '';

if (!token) {
  console.warn('Aviso: CALLBACK_AUTH_TOKEN vazio no .env — o callback vai responder 401.');
}

const environment = {
  id: randomUUID(),
  name: 'POC Decision Backend (local)',
  values: [
    { key: 'url', value: apiUrl, type: 'default', enabled: true },
    { key: 'n8n', value: n8nUrl, type: 'default', enabled: true },
    // `secret` faz o Postman mascarar o valor na interface.
    { key: 'bearerToken', value: token, type: 'secret', enabled: true },
    // `transactionId` NÃO entra aqui de propósito. É estado de runtime, preenchido
    // pelo teste do "Create Transaction" no escopo de collection. Como variável de
    // environment tem precedência sobre a de collection no Postman, declará-la aqui
    // (mesmo vazia) sobrescreveria o valor gravado em runtime e quebraria o callback.
  ],
  _postman_variable_scope: 'environment',
  _postman_exported_at: new Date().toISOString(),
  _postman_exported_using: 'scripts/generate-postman-env.mjs',
};

writeFileSync(outPath, `${JSON.stringify(environment, null, 2)}\n`);

console.log(`Environment gerado: ${outPath}`);
console.log(`  url         = ${apiUrl}`);
console.log(`  n8n         = ${n8nUrl}`);
console.log(`  bearerToken = ${token ? `${token.slice(0, 6)}… (${token.length} chars)` : '(vazio)'}`);
console.log('\nNo Postman: Import > selecione o arquivo > escolha o environment no seletor (canto superior direito).');
console.log('O arquivo contém o segredo e está no .gitignore — não commite.');

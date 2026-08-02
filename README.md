# 🚀 poc-decision-backend

[![CI](https://github.com/jvcamargoalmeida/poc-decision-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/jvcamargoalmeida/poc-decision-backend/actions/workflows/ci.yml)

O `poc-decision-backend` é um motor de processamento financeiro orientado a eventos, projetado especificamente para suportar alta volumetria e rigorosos requisitos de baixa latência. 

Desenvolvido em **TypeScript** sobre o ecossistema **Fastify**, o projeto aplica rigorosamente os princípios de **Clean Architecture** e **Domain-Driven Design (DDD)**. Esta Prova de Conceito (PoC) demonstra a capacidade de orquestrar fluxos complexos, isolando regras de negócio e infraestrutura.

A arquitetura dispensa o uso de ORMs pesados em favor de drivers nativos e padrão *Repository*, garantindo controle absoluto sobre o plano de execução e o *Connection Pooling*.

### 🏗️ Destaques Arquiteturais:
* **Alta Volumetria (Throughput):** Roteamento otimizado com Fastify.
* **Persistência Híbrida e Distribuída:** 
  * **Oracle DB (SQL Nativo):** Armazenamento de dados transacionais e resultados estruturados.
  * **MongoDB:** Armazenamento flexível para logs de auditoria e *payloads* brutos.
* **Mensageria e Assincronicidade:** Desacoplamento de processos utilizando filas no **RabbitMQ** para ingestão e processamento de dados.
* **Integração NoCode:** Orquestração de cálculos e algoritmos estatísticos externos via Webhooks comunicando-se com o **n8n**.
* **Observabilidade (APM Ready):** Geração de logs estruturados em padrão estrito JSON através do **Winston**, prontos para ingestão em stacks de monitoramento como Datadog ou Elastic (ELK).

## 📋 Pré-requisitos

* [nvm](https://github.com/nvm-sh/nvm) — a versão do Node é fixada em [`.nvmrc`](.nvmrc)
* [Docker](https://www.docker.com/) e Docker Compose — para subir RabbitMQ, MongoDB, Oracle XE e n8n localmente

## 🚀 Como rodar

```bash
nvm use
npm install
cp .env.example .env

# sobe RabbitMQ, MongoDB, Oracle XE e n8n
docker compose up -d

npm run dev
```

O servidor sobe em `http://localhost:3000`; `GET /health` retorna o status da aplicação.

## 📜 Scripts disponíveis

| Script                  | Descrição                                                  |
| ----------------------- | ---------------------------------------------------------- |
| `npm run dev`           | Sobe o servidor em modo desenvolvimento (`ts-node-dev`)    |
| `npm run build`         | Compila o TypeScript para `dist/`                          |
| `npm start`             | Roda o build compilado (`dist/server.js`)                  |
| `npm run typecheck`     | Type-checking de `src/` e `tests/`, sem emitir arquivos    |
| `npm test`              | Executa a suíte de testes unitários (Vitest) uma única vez |
| `npm run test:watch`    | Executa os testes em modo watch                            |
| `npm run test:coverage` | Executa os testes com relatório de cobertura               |

## 🗂️ Estrutura do projeto

```text
src/
├── domain/
│   ├── entities/         # Transaction
│   ├── enums/            # RiskLevel
│   ├── repositories/     # ITransactionRepository (interface)
│   └── strategies/risk/  # IRiskStrategy, AmountRiskStrategy
├── application/          # Use Cases (a implementar)
├── infrastructure/       # Oracle, Mongo, RabbitMQ, Winston (implementações)
└── presentation/         # Servidor Fastify, rotas e plugins
tests/                    # Testes unitários (espelha a estrutura de src/)
```

Os limites do que a IA pode gerar em cada camada estão documentados em [`CLAUDE.md`](CLAUDE.md).

## 🧪 Testes e Cobertura

O projeto usa **Vitest**. Todo Pull Request para `main` precisa manter cobertura mínima de **95%** (statements, branches, functions e lines) — configurado em [`vitest.config.mts`](vitest.config.mts) e verificado automaticamente pelo CI. Detalhes da política em [`CLAUDE.md`](CLAUDE.md#-cicd-e-cobertura-de-testes).

## ⚙️ CI/CD

O pipeline (`.github/workflows/ci.yml`) roda em todo Pull Request e push para `main`: typecheck, build, smoke test do `npm run dev`, testes com cobertura (com resumo comentado na PR) e validação do `docker-compose.yml`. O merge só deve ser liberado com o check `ci-status` obrigatório na proteção da branch `main`.

Não há Dependabot no projeto (removido — atualizações de dependência são feitas manualmente, uma de cada vez). Detalhes em [`CLAUDE.md`](CLAUDE.md).

## 🔐 Variáveis de ambiente

Veja [`.env.example`](.env.example) para a lista completa (Oracle, MongoDB, RabbitMQ, n8n e configurações do servidor).

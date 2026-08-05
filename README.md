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
* **Mensageria e Assincronicidade:** Desacoplamento de processos utilizando filas no **RabbitMQ** para ingestão e processamento de dados, com *dead-letter queue* em todas as filas.
* **Integração NoCode:** Orquestração de cálculos e algoritmos estatísticos externos com o **n8n**, por dois transportes alternáveis — Webhook (*push*) ou consumo direto da fila pelo próprio n8n (*pull*, com *backpressure* natural).
* **Idempotência:** Header `Idempotency-Key` do cliente, com unicidade garantida pelo banco e recuperação de corrida entre requisições concorrentes.
* **Observabilidade (APM Ready):** Geração de logs estruturados em padrão estrito JSON através do **Winston**, prontos para ingestão em stacks de monitoramento como Datadog ou Elastic (ELK).

## 🔄 Fluxo de Negócio (Visão Geral)

1. **Ingestão síncrona:** `POST /transactions` → cálculo de risco interno (Strategy Pattern) → persistência no Oracle (SQL nativo) → resposta `201/202` imediata ao cliente, sem esperar processamento externo.
2. **Auditoria e distribuição (assíncrono):** o payload bruto é gravado no MongoDB (data lake/compliance) e um evento "Transação Criada" é publicado no RabbitMQ.
3. **Decisão externa:** o **n8n** roda o fluxo visual de decisão (simulando engines de fraude/crédito).
4. **Aplicação da decisão:** o status final da transação é atualizado no Oracle.

Os passos 3 e 4 têm **dois transportes**, alternados pela variável `DECISION_TRANSPORT`:

| | `http` | `queue` |
| --- | --- | --- |
| Ida | um Worker consome a fila e **empurra** um Webhook para o n8n | o próprio n8n **puxa** da fila `…decision.requests` |
| Volta | o n8n chama `PATCH /callback/transactions` (bearer token) | o n8n publica em `…decision.results`, e o `DecisionResultWorker` aplica |
| Quando usar | orquestrador externo/SaaS, que não deve receber credencial do broker | orquestrador interno — ganha *backpressure* de graça |

A diferença não é cosmética: no modo `http` **nós** ditamos o ritmo do n8n e o saturamos sob carga
(6.552 respostas `503` medidas no teste de carga); no modo `queue` **ele** consome no ritmo dele e
a fila absorve o pico. Comparação completa em [`ARCHITECTURE.md`](ARCHITECTURE.md#33-dois-transportes-para-a-decisão-externa).

A especificação funcional/não funcional completa (RF/RNF) e o mapeamento arquivo-a-arquivo de cada fase estão em [`SPECIFICATION.md`](SPECIFICATION.md). O progresso real da implementação (o que já está pronto vs. planejado) está em [`ROADMAP.md`](ROADMAP.md).

## 📋 Pré-requisitos

* [nvm](https://github.com/nvm-sh/nvm) — a versão do Node é fixada em [`.nvmrc`](.nvmrc)
* [Docker](https://www.docker.com/) e Docker Compose — para subir RabbitMQ, MongoDB, Oracle XE e n8n localmente

## 🚀 Como rodar

```bash
nvm use
npm install
cp .env.example .env

# sobe RabbitMQ, MongoDB, Oracle XE e n8n
# (o n8n importa, publica e credencia o fluxo de decisão sozinho na 1ª subida —
# ver n8n-workflows/README.md; nenhum passo manual é necessário)
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
| `npm run test:load`     | Teste de carga com Autocannon (ver [`LOAD-TEST.md`](LOAD-TEST.md)) |

## 🗂️ Estrutura do projeto

```text
src/
├── domain/               # Regras e contratos, sem dependência de framework
│   ├── entities/         # Transaction
│   ├── enums/            # RiskLevel, TransactionStatus
│   ├── errors/           # DomainError, TransactionNotFoundError
│   ├── events/           # IEventPublisher
│   ├── repositories/     # ITransactionRepository, IAuditRepository
│   ├── services/         # IDecisionGateway
│   └── strategies/risk/  # IRiskStrategy, AmountRiskStrategy
├── application/          # Use Cases (Process / UpdateTransactionStatus)
├── infrastructure/       # Implementações: Oracle, Mongo, RabbitMQ, n8n, Winston, shutdown
│   └── messaging/rabbitmq/workers/
│       ├── TransactionWorker.ts       # modo http: consome e chama o webhook do n8n
│       └── DecisionResultWorker.ts    # modo queue: consome a decisão publicada pelo n8n
└── presentation/         # Fastify: rotas, controllers, middlewares e composition root
tests/                    # Testes unitários (espelha a estrutura de src/)
db/oracle/init/           # Scripts .sql/.sh rodados na 1ª inicialização do Oracle (ver README na pasta)
n8n-workflows/            # Fluxos do n8n versionados (webhook e fila) + template de credencial, importados no boot (ver README na pasta)
```

Os limites do que a IA pode gerar em cada camada estão documentados em [`CLAUDE.md`](CLAUDE.md).

## 🧪 Testes e Cobertura

O projeto usa **Vitest**. Todo Pull Request para `main` precisa manter cobertura mínima de **95%** (statements, branches, functions e lines) — configurado em [`vitest.config.mts`](vitest.config.mts) e verificado automaticamente pelo CI. Detalhes da política em [`CLAUDE.md`](CLAUDE.md#-cicd-e-cobertura-de-testes).

## ⚙️ CI/CD

O pipeline (`.github/workflows/ci.yml`) roda em todo Pull Request e push para `main`: typecheck, build, smoke test do `npm run dev`, testes com cobertura (com resumo comentado na PR) e validação do `docker-compose.yml`. O merge só deve ser liberado com o check `ci-status` obrigatório na proteção da branch `main`.

Não há Dependabot no projeto (removido — atualizações de dependência são feitas manualmente, uma de cada vez). Detalhes em [`CLAUDE.md`](CLAUDE.md).

## 🔐 Variáveis de ambiente e autenticação

Veja [`.env.example`](.env.example) para a lista completa (Oracle, MongoDB, RabbitMQ, n8n e configurações do servidor).

As duas rotas de negócio exigem *bearer token* — sem credencial válida respondem `401`. `GET /health` segue pública, por ser alvo de monitoração.

| Rota | Credencial |
| --- | --- |
| `POST /transactions` | `API_AUTH_TOKEN` (clientes da API) |
| `PATCH /callback/transactions` | `CALLBACK_AUTH_TOKEN` (n8n) |

Os segredos são separados de propósito: cliente e n8n são atores distintos, então o vazamento de um não concede acesso ao outro. Ambos são comparados em tempo constante (`crypto.timingSafeEqual` sobre o hash SHA-256, para não vazar informação por timing nem pelo comprimento do token). Não há dependência externa: só o `crypto` nativo do Node.

Ambas as rotas também têm **rate limiting por IP** (`RATE_LIMIT_MAX` por `RATE_LIMIT_WINDOW_MS`), respondendo `429` com `Retry-After`. O contador roda antes da verificação de credencial — requisição não autenticada também consome cota, senão daria para brutar credencial sem limite.

O n8n envia esse header através de uma credencial *Bearer Auth*. Credenciais não são versionadas junto com o workflow (o segredo não entra no git) — em vez disso, o `docker-compose.yml` materializa a credencial no boot a partir de um template com placeholder, injetando o valor do `.env` (ver [`n8n-workflows/README.md`](n8n-workflows/README.md)).

### Escolhendo o transporte da decisão

```bash
DECISION_TRANSPORT=queue   # n8n consome da fila (padrão do .env.example)
DECISION_TRANSPORT=http    # n8n recebe webhook (comportamento na ausência da variável)
```

No modo `queue` o n8n precisa falar com o broker, então a credencial `RabbitMQ account` é
materializada no boot a partir de `RABBITMQ_USER`/`RABBITMQ_PASSWORD`. Dentro da rede do compose o
host é `rabbitmq`, não `localhost`. Nesse modo somem o webhook e a rota de callback do caminho: o
controle de acesso à mudança de status passa a ser do RabbitMQ, não do *bearer token*.

Trocar o valor exige reiniciar a aplicação — a topologia das filas é declarada no bootstrap. As
filas em si existem e são duráveis nos dois modos; o que muda é qual delas fica ligada à exchange.
Só o transporte ativo recebe `transaction.created`, para que a fila do transporte ocioso não
acumule pedidos que o outro já decidiu.

## 📚 Documentação

| Documento | Conteúdo |
| --- | --- |
| [`SPECIFICATION.md`](SPECIFICATION.md) | Requisitos funcionais/não funcionais (RF/RNF) e a jornada completa da transação, mapeada arquivo a arquivo |
| [`ROADMAP.md`](ROADMAP.md) | Progresso real da implementação, fase a fase |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Diagramas de eventos, entidades e sistema (Mermaid) |
| [`CLAUDE.md`](CLAUDE.md) | Padrões de engenharia e limites de geração automatizada de código por IA |
| [`LOAD-TEST.md`](LOAD-TEST.md) | Resultados do teste de carga e os gargalos que ele revelou |

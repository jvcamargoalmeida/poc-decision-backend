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

## 🔄 Fluxo de Negócio (Visão Geral)

1. **Ingestão síncrona:** `POST /transactions` → cálculo de risco interno (Strategy Pattern) → persistência no Oracle (SQL nativo) → resposta `201/202` imediata ao cliente, sem esperar processamento externo.
2. **Auditoria e distribuição (assíncrono):** o payload bruto é gravado no MongoDB (data lake/compliance) e um evento "Transação Criada" é publicado no RabbitMQ.
3. **Decisão externa:** um Worker consome a fila e dispara um Webhook para o **n8n**, que roda o fluxo visual de decisão (simulando engines de fraude/crédito).
4. **Callback:** o n8n retorna a decisão via `PATCH /callback/transactions` (autenticado por *bearer token*), atualizando o status final da transação no Oracle.

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
# (o n8n já importa o fluxo de decisão sozinho na 1ª subida, ver n8n-workflows/README.md —
# só falta ativá-lo manualmente em http://localhost:5678 depois)
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
| `npm run postman:env`   | Gera o Postman Environment a partir do `.env`               |

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
└── presentation/         # Fastify: rotas, controllers, middlewares e composition root
tests/                    # Testes unitários (espelha a estrutura de src/)
db/oracle/init/           # Scripts .sql/.sh rodados na 1ª inicialização do Oracle (ver README na pasta)
n8n-workflows/            # Fluxo do n8n versionado + template de credencial, importados no boot (ver README na pasta)
```

Os limites do que a IA pode gerar em cada camada estão documentados em [`CLAUDE.md`](CLAUDE.md).

## 🧪 Testes e Cobertura

O projeto usa **Vitest**. Todo Pull Request para `main` precisa manter cobertura mínima de **95%** (statements, branches, functions e lines) — configurado em [`vitest.config.mts`](vitest.config.mts) e verificado automaticamente pelo CI. Detalhes da política em [`CLAUDE.md`](CLAUDE.md#-cicd-e-cobertura-de-testes).

## ⚙️ CI/CD

O pipeline (`.github/workflows/ci.yml`) roda em todo Pull Request e push para `main`: typecheck, build, smoke test do `npm run dev`, testes com cobertura (com resumo comentado na PR) e validação do `docker-compose.yml`. O merge só deve ser liberado com o check `ci-status` obrigatório na proteção da branch `main`.

Não há Dependabot no projeto (removido — atualizações de dependência são feitas manualmente, uma de cada vez). Detalhes em [`CLAUDE.md`](CLAUDE.md).

## 🔐 Variáveis de ambiente e autenticação

Veja [`.env.example`](.env.example) para a lista completa (Oracle, MongoDB, RabbitMQ, n8n e configurações do servidor).

A rota de callback (`PATCH /callback/transactions`) é protegida por *bearer token* — sem credencial válida responde `401`. O segredo vem de `CALLBACK_AUTH_TOKEN` e é comparado em tempo constante (`crypto.timingSafeEqual` sobre o hash SHA-256 dos valores, para não vazar informação por timing nem pelo comprimento do token). Não há dependência externa: só o `crypto` nativo do Node.

O n8n envia esse header através de uma credencial *Bearer Auth*. Credenciais não são versionadas junto com o workflow (o segredo não entra no git) — em vez disso, o `docker-compose.yml` materializa a credencial no boot a partir de um template com placeholder, injetando o valor do `.env` (ver [`n8n-workflows/README.md`](n8n-workflows/README.md)).

## 📮 Postman

A collection versionada é [`poc_decision_backend.postman_collection.json`](poc_decision_backend.postman_collection.json), com exemplos de resposta reais e scripts de teste (roda também via `newman`).

Ela referencia `{{url}}`, `{{n8n}}` e `{{bearerToken}}`, mas **não** carrega o segredo. Como o Postman não lê o filesystem (nem ao importar, nem em pre-request script — o sandbox não expõe `fs`), o caminho é gerar um *Environment* a partir do seu `.env`:

```bash
npm run postman:env   # gera poc_decision_backend.postman_environment.json
```

No Postman: **Import** os dois arquivos e selecione o environment no canto superior direito. O arquivo gerado contém o token e está no `.gitignore` — não deve ser commitado.

O `transactionId` não vem do `.env`: é estado de runtime, gravado pelo request *Create Transaction* e consumido pelo *Callback*, encadeando os dois automaticamente.

## 📚 Documentação

| Documento | Conteúdo |
| --- | --- |
| [`SPECIFICATION.md`](SPECIFICATION.md) | Requisitos funcionais/não funcionais (RF/RNF) e a jornada completa da transação, mapeada arquivo a arquivo |
| [`ROADMAP.md`](ROADMAP.md) | Progresso real da implementação, fase a fase |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Diagramas de eventos, entidades e sistema (Mermaid) |
| [`CLAUDE.md`](CLAUDE.md) | Padrões de engenharia e limites de geração automatizada de código por IA |
| [`LOAD-TEST.md`](LOAD-TEST.md) | Resultados do teste de carga e os gargalos que ele revelou |

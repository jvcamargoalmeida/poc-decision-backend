# Roadmap de Desenvolvimento: poc-decision-backend

Acompanhamento das entregas e fases de implementação da Prova de Conceito (PoC). O projeto é orientado a Clean Architecture, suporta alta volumetria e utiliza persistência híbrida e orientada a eventos.

## Fase 1: Setup e Governança [Concluído]
- [x] Inicialização do projeto Node.js (TypeScript + Fastify).
- [x] Definição de diretrizes restritas de IA e arquitetura (`CLAUDE.md`).
- [x] Provisionamento de infraestrutura local via Docker Compose (Oracle, MongoDB, RabbitMQ, n8n).
- [x] Configuração do framework de testes (Vitest) com threshold obrigatório de 95% de cobertura.
- [x] Implementação de pipeline CI/CD (GitHub Actions) com branch protection.

## Fase 2: Core Domain e Casos de Uso [Concluído]
- [x] Modelagem de Entidades e Enums de Domínio (`Transaction`, `RiskLevel`).
- [x] Implementação do Design Pattern Strategy para regras de negócio e cálculo de risco.
- [x] Definição de Ports (Interfaces de Repositório).
- [x] Implementação manual das queries SQL nativas (INSERT com `RETURNING...INTO` + SELECT, bind variables) e mapeamento Row → Entity no `OracleTransactionRepository` (`save`/`findById`, gerenciamento de conexão via `try/finally`).
- [x] Implementação manual da orquestração real em `ProcessTransactionUseCase.execute()` (cálculo de risco via `IRiskStrategy`, persistência via `ITransactionRepository`, e só então publicação do evento via `IEventPublisher` e gravação do audit log via `IAuditRepository`, nessa ordem, usando a transação já persistida com o ID gerado pelo Oracle).

## Fase 3: Camada de Apresentação (Presentation) [Concluído]

- [x] Criação de Controllers HTTP (`TransactionController`) e validação de payload (JSON Schema do Fastify, com `additionalProperties: false` reforçado via `removeAdditional: false` no AJV).
- [x] Configuração de Injeção de Dependências (IoC) para repositórios, strategies e casos de uso (composition root manual em `presentation/container.ts`).
- [x] Mapeamento de rotas Fastify (`POST /transactions`).
- [x] Implementação de Middleware global para tratamento de exceções (`setErrorHandler`, distingue erro de validação de erro interno).

## Fase 4: Processamento Assíncrono e Mensageria [Concluído]

- [x] Implementação manual do `RabbitMQPublisher` (`IEventPublisher`, injeção do `Channel`, serialização do evento em JSON e publicação numa exchange `topic` durável).
- [x] Implementação manual do Schema/Model do Mongoose (`AuditLog.model.ts`) e da escrita do documento de auditoria em `MongoAuditRepository` (Model injetado via composition root, não a `Connection` crua).
- [x] Configuração do listener do Consumer/Worker RabbitMQ (`TransactionWorker`, registrado no bootstrap do `server.ts`; fila `transactions.queue` validada com 1 consumer ativo).
- [x] Implementação manual do processamento da mensagem em `TransactionWorker` (parse do payload, `ack` só no sucesso, `nack` sem requeue em caso de falha para evitar reprocessamento infinito de mensagem envenenada, `consumerTag` armazenado para permitir `stop()` correto). O roteamento efetivo para o n8n (chamada do webhook) fica para a Fase 5, que já tem esse item em aberto.

## Fase 5: Integração e Orquestração Externa (n8n) [Concluído]

- [x] Implementação manual do `N8nWebhookClient` (`IDecisionGateway`, chamada `POST` via `fetch` nativo ao webhook do n8n, lança erro em resposta não-OK ou falha de rede). Injetado no `TransactionWorker` (Fase 4), que chama `requestDecision()` **antes** de republicar `transaction.processed` — evita anunciar o processamento como concluído antes de confirmar a decisão externa (mesma classe de "evento fantasma" já corrigida no `ProcessTransactionUseCase`); `nack` sem requeue se a chamada ao n8n falhar. `server.ts` valida `N8N_WEBHOOK_URL` no boot (mesmo padrão de `MONGO_URI`/`ORACLE_CONNECT_STRING`).
- [x] Configuração do fluxo de aprovação e risco simulado no ambiente n8n (workflow "Decision": `Webhook` recebe a transação → `If` decide com base no `riskScore` → `HTTP Request` faz o callback). Exportado para `n8n-workflows/fraud-analysis.json` e versionado. `docker-compose.yml` importa esse arquivo automaticamente na 1ª subida do container `n8n` (marcador em `.n8n/.workflow-imported` evita reimportar — mesmo espírito do init script do Oracle, adaptado via `entrypoint` customizado já que a imagem do n8n não tem esse hook nativo). A importação sempre deixa o fluxo inativo, então o entrypoint encadeia um `n8n publish:workflow` logo depois: quem clona o repositório sobe com o fluxo já publicado, sem passo manual na UI.
- [x] Rota de Callback (`PATCH /callback/transactions`, validação de payload via JSON Schema com `enum` restringindo `status` aos valores de `TransactionStatus`) e implementação manual de `CallbackController` (404 via `TransactionNotFoundError` dedicado, 500 sem vazar detalhe interno, log estruturado via Winston), `UpdateTransactionStatusUseCase.execute()` e do `UPDATE` transacional em `OracleTransactionRepository.updateStatus()`.
- [x] Validado end-to-end de verdade (não só testes unitários): `POST /transactions` com risco `HIGH` → worker → n8n → callback → status final `FAILED` no Oracle; risco `LOW` → `COMPLETED`. Achado no caminho: o payload que chega no webhook do n8n vem embrulhado no envelope `{ eventName, timestamp, data }` que o `RabbitMQPublisher` usa para todo evento — os nodes do n8n referenciam `$json.body.data.*`, não `$json.body.*` direto.
- [x] Autenticação da rota de callback (*bearer token* via `CALLBACK_AUTH_TOKEN`, hook `preHandler` do Fastify em `presentation/middlewares/bearer-auth.ts`). Comparação em tempo constante com `crypto.timingSafeEqual` sobre o hash SHA-256 dos valores — o hash normaliza o tamanho dos buffers, evitando tanto a exceção do `timingSafeEqual` com tamanhos diferentes quanto o vazamento do comprimento do segredo. Zero dependência externa. O hook lança `UnauthorizedError` (`statusCode` 401) em vez de responder direto, deixando o `errorHandler` global padronizar corpo e log. No n8n o header vem de uma credencial *Header Auth*, que não é versionada no `fraud-analysis.json` (segredo fora do git) e precisa ser recriada por ambiente.
- [x] Erros de domínio isolados em `src/domain/errors/` (`DomainError` abstrato + `TransactionNotFoundError`), fora do arquivo do Use Case. A base deliberadamente não carrega `statusCode`: o domínio não conhece HTTP, e o mapeamento erro → status fica na camada de apresentação.

## Fase 6: Observabilidade e Resiliência [Concluído]

- [x] Configuração de Structured Logging com Winston (formato JSON estrito: `timestamp` + `errors({stack:true})` + `json()`, com `defaultMeta.service`).
- [x] Instrumentação de logs nos Casos de Uso: `ProcessTransactionUseCase` registra a transação persistida (com `transactionId`, valor, moeda e risco) e `UpdateTransactionStatusUseCase` registra a transição de status (com o status anterior e o novo), fechando o rastreio da transação pelo caminho de orquestração. Infraestrutura e apresentação já logavam.
- [x] Implementação de rotinas de Graceful Shutdown (`infrastructure/lifecycle/graceful-shutdown.ts`, registrado no `server.ts`). Responde a `SIGTERM`/`SIGINT`, encerra na ordem correta (HTTP → worker → RabbitMQ → Mongo → Oracle: primeiro para de aceitar trabalho novo, depois fecha as conexões que esse trabalho usaria), tolera falha de um passo sem abortar os demais (sai com código 1 nesse caso) e tem timeout de 10s que força a saída se algum recurso travar. Validado com `SIGTERM` real: os 5 recursos fecharam em ~100ms e o processo saiu limpo.

## Fase 7: Qualidade e Testes (QA) [Concluído]
- [x] Testes unitários das estratégias de domínio (`AmountRiskStrategy`, 100% de cobertura).
- [x] Testes unitários do repositório Oracle (`OracleTransactionRepository`: `save`/`findById`, incluindo tratamento de erro do driver e não vazamento de conexão).
- [x] Testes unitários dos casos de uso (`ProcessTransactionUseCase`, aplicando mocks de `ITransactionRepository`/`IRiskStrategy`).
- [x] Testes unitários da camada de apresentação (`TransactionController`, error handler, registro de rotas).
- [x] Testes unitários do `CallbackController` (sucesso, `404` via `TransactionNotFoundError`, `500` sem vazar detalhe interno) e do `UpdateTransactionStatusUseCase`.
- [x] Testes unitários de mensageria/auditoria (`RabbitMQPublisher`: serialização e publicação na exchange, propagação de erro; `MongoAuditRepository`: criação e gravação do documento via Model injetado, propagação de erro; `TransactionWorker`: registro do listener, processamento com `ack`/`nack` corretos, mensagem `null` ignorada, `stop()` com e sem consumer ativo, ordem `requestDecision` → `publish` comprovada via `invocationCallOrder`, `publish` não ocorre se o n8n falhar; `N8nWebhookClient`: chamada HTTP via `fetch` mockado, erro em resposta não-OK e em falha de rede).
- [x] Validação de aderência ao threshold de 95% em pipeline (gate ativo desde a Fase 1).

## Fase 8: Documentação Arquitetural [Concluído]

- [x] Modelagem do Diagrama Entidade-Relacionamento (DER) em `ARCHITECTURE.md`, cobrindo `transactions` (Oracle) e `auditlogs` (MongoDB) e explicitando que o vínculo entre os dois é lógico, feito pela aplicação, sem chave estrangeira.
- [x] Mapeamento de Arquitetura em Modelo C4 (Contexto e Contêiner) em `ARCHITECTURE.md`.
- [x] Diagrama de Sequência de Transações (API -> Oracle -> Fila -> Worker -> n8n -> Callback) em `ARCHITECTURE.md`, incluindo as ordenações deliberadas que evitam "evento fantasma".
- [x] Todos os diagramas Mermaid validados com `mermaid-cli` (renderizam de fato, não apenas "parecem certos").

## Fase 9: Testes de Carga e Validação Arquitetural [Concluído]
*Cenário em `SPECIFICATION.md` seção 4; resultados completos em [`LOAD-TEST.md`](LOAD-TEST.md).*

- [x] Cenário de carga com Autocannon (`npm run test:load`: 100 conexões, 30s) contra `POST /transactions`, executado sobre o build compilado e não sobre o `ts-node-dev`.
- [x] Validação de estabilidade da Fase A: **nenhuma resposta não-2xx** e todas as ~15,5 mil transações gravadas no Oracle. A borda síncrona sustentou a carga.
- [x] Registro dos resultados: ~515 req/s, p50 108ms, p99 1.947ms com 100 conexões.
- [x] **Achado**: mais concorrência entregou *menos* throughput (774 req/s com 10 conexões vs 515 com 100) — saturação, provavelmente por `ORACLE_POOL_MAX=10` somado a `publish`/`logTransaction` estarem dentro da requisição.
- [x] **Achado crítico**: o gargalo real foi o n8n, não a API. Ele passou a responder `503` sob carga e 7.866 mensagens foram descartadas definitivamente pelo `nack` sem requeue — metade das transações aceitas com `201` nunca recebeu decisão e ficou presa em `PENDING`, sem o cliente saber.

## Fase 10: Transporte Alternativo da Decisão por Fila [Concluído]
*Motivada pelo achado crítico da Fase 9: o gargalo era o n8n, e a causa raiz era arquitetural — nós **empurrávamos** trabalho para ele. Detalhes e comparação em [`ARCHITECTURE.md`](ARCHITECTURE.md) seção 3.3.*

- [x] Chave `DECISION_TRANSPORT` (`http` | `queue`) no bootstrap. A ausência da variável resolve para `http` — o comportamento anterior segue sendo o padrão conservador do código. O `.env.example` ships `queue` porque nesta PoC o n8n é interno.
- [x] Topologia nova declarada em `src/server.ts`: `transactions.queue.decision.requests` (ligada a `transaction.created`) e `transactions.queue.decision.results` (ligada a `transaction.decided`), ambas duráveis e com a mesma *dead-letter exchange* das demais.
- [x] Implementação manual do `DecisionResultWorker` (consome a fila de resultados, revalida `id` e `status` contra o enum já que não há JSON Schema nesse caminho, `ack` só no sucesso, `nack` sem requeue → DLQ). Reaproveita o `UpdateTransactionStatusUseCase` **sem duplicar regra**, via `buildUpdateTransactionStatusUseCase(pool)` extraído do composition root.
- [x] Workflow `n8n-workflows/fraud-analysis-queue.json` versionado: `RabbitMQ Trigger` → `If` sobre `$json.data.riskScore` → dois nodes `RabbitMQ` publicando `transaction.decided`. Importado e publicado no boot pelo mesmo mecanismo do fluxo de webhook (marcador `.queue-workflow-imported`).
- [x] Credencial `RabbitMQ account` adicionada ao `credentials.template.json`, materializada no boot a partir de `RABBITMQ_USER`/`RABBITMQ_PASSWORD` do `.env` — o segredo continua fora do git. Dentro da rede do compose o host é `rabbitmq`, não `localhost`.
- [x] Testes do `DecisionResultWorker` (registro do listener, `ack` no sucesso, mensagem `null` ignorada, status fora do enum, `id` ausente, JSON malformado, `TransactionNotFoundError` sem requeue, `stop()` com e sem consumer). A suíte estava em 115 testes ao fim desta fase; ver Fase 11 para o número atual.
- [x] Validado ponta a ponta no modo `queue`: `POST /transactions` → n8n consome de `decision.requests` (1 consumer ativo confirmado no `rabbitmqctl`) → publica em `transaction.decided` → `DecisionResultWorker` aplica → status final no Oracle. Payload inválido injetado na fila de resultados foi rejeitado sem tocar no banco.
- [x] Workflow versionado conferido contra o que roda de fato no n8n (`export:workflow` vs. arquivo do repo): `nodes` e `connections` idênticos, então quem clonar o repositório recebe o fluxo que realmente funciona.

## Fase 11: Endurecimento — Idempotência, Segurança e Resiliência [Concluído]
*Cada item aqui nasceu de um gap identificado durante a implementação ou medido no teste de carga, não de um requisito planejado no início. A ordem abaixo é a de descoberta.*

### Idempotência (RF09)

- [x] Coluna `idempotency_key` com **índice único** — índice, não *constraint*: no Oracle índice único admite múltiplos `NULL`s, então a chave permanece opcional e as linhas antigas seguem válidas.
- [x] A chave vem do **cliente**, pelo header `Idempotency-Key` (convenção do Stripe). Se o servidor a gerasse, um retry geraria outra e duplicaria assim mesmo.
- [x] Corrida tratada no banco, não na aplicação: duas requisições simultâneas passam juntas pela verificação prévia, e quem garante a unicidade é o índice. O repositório traduz `ORA-00001` em `DuplicateIdempotencyKeyError` (erro de domínio — a aplicação não conhece código de driver) e o caso de uso recupera a vencedora.
- [x] Validado com **20 requisições verdadeiramente concorrentes** (`curl --parallel`) com a mesma chave: 20 respostas com **1 único id**, **1 linha** no banco e **7 corridas** resolvidas pela constraint — o caminho que, sem tratamento, viraria `500`.
- [x] **Migração em ambiente existente** (o init script só roda em volume novo): `ALTER TABLE transactions ADD (idempotency_key VARCHAR2(64));` e `CREATE UNIQUE INDEX ux_transactions_idempotency_key ON transactions (idempotency_key);`

### Autenticação, identidade e proteção contra abuso (RNF08, RNF12)

- [x] `POST /transactions` passou a exigir *bearer token*, com segredo **separado** do callback: cliente da API e n8n são atores distintos, então o vazamento de um não concede acesso ao outro.
- [x] Rate limiting por IP (janela fixa, em memória, sem dependência nova) nas duas rotas de negócio, com `429` + `Retry-After` e headers `X-RateLimit-*`. `GET /health` segue livre, por ser alvo de monitoração. O contador roda no estágio `onRequest`, **antes** da verificação de credencial — senão daria para brutar credencial sem limite.
  - **Limitações assumidas**: o estado vive no processo, então com várias instâncias o teto efetivo vira `max × instâncias` (em cluster exigiria Redis). O bucket é por IP e compartilhado entre as rotas.
- [x] Credencial **por cliente** via `API_CLIENTS` (`id:token,id:token`): o hook resolve *qual* cliente chamou e o `clientId` flui até o campo indexado do documento de auditoria. Revogar um cliente deixou de derrubar os outros.
  - A lista é percorrida **inteira** mesmo após achar o par correto: sair no primeiro acerto faria o tempo variar com a posição do cliente, devolvendo pela porta dos fundos o vazamento por *timing* que o `safeCompare` evita.
  - Sem `API_CLIENTS`, o `API_AUTH_TOKEN` vale como cliente único `default` — o que manteve teste de carga, CI e Postman funcionando sem reconfiguração.
- [x] **Bypass de decisão via webhook do n8n** fechado: o node `Webhook` exige *Header Auth*. Antes, quem alcançasse o container do n8n na rede postava direto no webhook e fazia o n8n — que possui a credencial válida do callback — alterar o status de qualquer transação.
- [x] Validado ponta a ponta: dois clientes com tokens distintos gravaram `clientId` distintos no Mongo; token desconhecido recebeu `401`; sem `API_CLIENTS` a ingestão respondeu `201` como `default`.

### Não perda de mensagem (RNF10, RNF11)

- [x] *Dead-letter exchange* em todas as filas. O `requeue: false` continua intencional (evita reprocessar mensagem envenenada para sempre), mas a mensagem rejeitada vai para `transactions.queue.dead` em vez de sumir, com o header `x-death` preservando motivo e origem.
- [x] **Retry com *backoff*** entre o worker e a fila morta: uma fila de espera por nível (5s/30s/120s, configurável em `RETRY_DELAYS_MS`), em `src/infrastructure/messaging/rabbitmq/retry.ts`. O worker republica na fila do nível atual e confirma a original; a mensagem fica parada até o `x-message-ttl` expirar e o **próprio broker** a devolver à fila de origem.
  - **Sem timer na aplicação**: quem agenda é o RabbitMQ. Um `setTimeout` evaporaria com o processo numa queda; a mensagem na fila sobrevive.
  - **Uma fila por nível**, não uma só com TTL por mensagem: a expiração é avaliada na cabeça da fila, então uma mensagem de 120s na frente seguraria as de 5s atrás dela.
  - **Retorno pela exchange padrão** com routing key igual ao nome da fila de origem — voltar pela `amq.topic` reentregaria a mensagem a toda fila ligada àquela chave, não só à que falhou.
  - **Erro definitivo não gasta tentativa**: JSON malformado, contrato violado e transação inexistente são `NonRetryableError` e vão direto para a DLQ.
  - **Trade-off assumido**: republicar e depois confirmar cria uma janela em que uma queda duplica a mensagem. É *at-least-once* deliberado — duplicar é preferível a perder, e é o mesmo motivo da `Idempotency-Key` existir.
- [x] Validado **contra o broker**, não só em teste unitário: mensagem numa fila de espera de 2s ficou parada, voltou sozinha depois do TTL, com conteúdo intacto, `x-attempt` preservado e `x-death` registrado.

### Correções de comportamento

- [x] **"Sucesso reportado como falha"** em `ProcessTransactionUseCase`: `publish` e `logTransaction` saíram do caminho de erro da requisição (`Promise.allSettled`). Quando eles rodam, o Oracle já confirmou a escrita — devolver `500` ali reportava como falha algo que de fato aconteceu.
  - **Trade-off**: uma falha no `publish` deixa a transação `PENDING` sem ninguém decidir. Trocamos "erro visível e enganoso" por "sucesso real com processamento incompleto". A saída completa seria *outbox pattern*, que continua como evolução possível.
- [x] **Fila de pedidos órfã** no transporte inativo: as duas filas de pedido estavam ligadas à mesma routing key, mas só uma tem consumidor por vez. Medido: 100 mensagens paradas com 0 consumers.
  - O problema era pior que desperdício de memória — o `TransactionWorker` pede decisão ao n8n para **toda** mensagem que consome, então ao voltar para `http` ele drenaria o acúmulo pedindo decisão de novo para transação já decidida, sobrescrevendo status final.
  - Corrigido com `bindQueue`/`unbindQueue` condicional ao transporte ativo. Preferido ao `x-message-ttl` na fila órfã porque TTL limita o tamanho do estrago, não a causa.

### Migrações em ambiente existente

O RabbitMQ **não altera argumento de fila já criada** — o app não sobe (`406 PRECONDITION_FAILED`). Cada caso abaixo foi reproduzido de propósito:

| Mudança | Sintoma | Remédio (uma vez) |
| --- | --- | --- |
| Adição da DLQ | `inequivalent arg 'x-dead-letter-exchange'` | `rabbitmqctl delete_queue transactions.queue` |
| Mudança de `RETRY_DELAYS_MS` | `inequivalent arg 'x-message-ttl'` | `rabbitmqctl delete_queue <fila>.retry.<n>` — o erro cru do driver é traduzido numa mensagem que já nomeia a fila e dá o comando |
| Acúmulo anterior ao vínculo condicional | worker drena histórico já decidido | `rabbitmqctl purge_queue transactions.queue` |

### Cobertura ao fim desta fase

- [x] **156 testes, 100% nas quatro métricas** (statements, branches, functions, lines) — bem acima do gate de 95%.
- [x] Os componentes novos desta fase concentram 37 desses testes: `retry.ts` (topologia, parsing da configuração, contagem de tentativas, tradução do `406`) e `bearer-auth.ts` (parsing de `API_CLIENTS`, resolução de identidade, rejeição sem herdar `clientId`).
- [x] Testes de retry nos dois workers cobrem os três desfechos: reagendar em falha transitória, descartar quando o orçamento acaba, e não gastar tentativa em erro definitivo.

### Continua em aberto

- **`clientId` é atribuição, não autorização**: todo cliente válido pode tudo. Escopo por cliente (quais operações, quais limites) exigiria um modelo de permissão, e o rate limit segue por IP, não por cliente.
- **Auditoria é registro único por transação**: `transactionId` é `unique` na coleção, então auditar eventos posteriores (a mudança de status, por exemplo) falharia por chave duplicada. Virar trilha de eventos exige remover a unicidade ou compô-la com o tipo de evento.
- **Sem *outbox pattern***: uma falha do `publish` na ingestão não é recuperável pelo retry, porque a mensagem nunca chegou ao broker.

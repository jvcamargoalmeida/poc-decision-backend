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
- [x] Configuração do fluxo de aprovação e risco simulado no ambiente n8n (workflow "Decision": `Webhook` recebe a transação → `If` decide com base no `riskScore` → `HTTP Request` faz o callback). Exportado para `n8n-workflows/fraud-analysis.json` e versionado. `docker-compose.yml` importa esse arquivo automaticamente na 1ª subida do container `n8n` (marcador em `.n8n/.workflow-imported` evita reimportar — mesmo espírito do init script do Oracle, adaptado via `entrypoint` customizado já que a imagem do n8n não tem esse hook nativo). Ativação do workflow continua manual (limitação do modo de deployment sem *queue/multi-main*), feita uma única vez.
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

## Gaps Conhecidos (Débito Técnico Documentado)

- **Idempotência / "phantom row" no `OracleTransactionRepository.save()`**: o INSERT roda com `autoCommit: true`; se a leitura do `outBinds` falhar *depois* do commit (ex.: driver não retornar o bind de saída por algum motivo), a linha já foi persistida no Oracle mas o método lança erro e o chamador recebe uma falha — a transação existe no banco sem que a aplicação saiba o ID gerado. Não há chave de idempotência nem constraint única para permitir um retry seguro (reconciliar com o registro já existente em vez de duplicar). Correção recomendada: introduzir uma idempotency key (gerada pelo client ou pelo `ProcessTransactionUseCase`) com constraint única na tabela e um `findByIdempotencyKey` de apoio, em vez de tratar o sintoma reativamente dentro de `save()`.
- **[RESOLVIDO] `POST /transactions` sem autenticação**: a rota de ingestão passou a exigir `Authorization: Bearer <API_AUTH_TOKEN>`, com a mesma comparação em tempo constante do callback. O token é **separado** do `CALLBACK_AUTH_TOKEN` de propósito: cliente da API e n8n são atores distintos, então o vazamento de um não concede acesso ao outro (apontar as duas variáveis para o mesmo valor continua possível, mas perde essa separação). Permanece em aberto a atribuição de identidade: o audit log registra *o que* aconteceu, não *qual cliente* pediu — para isso seria preciso uma credencial por cliente, não um segredo compartilhado.
- **[RESOLVIDO] Sem rate limiting em nenhuma rota**: `POST /transactions` e `PATCH /callback/transactions` agora passam por um limitador por IP (janela fixa, em memória, sem dependência nova), respondendo `429` com `Retry-After` e headers `X-RateLimit-*`. `GET /health` segue livre, por ser alvo de monitoração. O contador roda no estágio `onRequest`, **antes** da verificação de credencial: requisição não autenticada também consome cota, senão daria para brutar credencial sem limite.
  - **Limitações assumidas**: o estado vive no processo, então com várias instâncias o teto efetivo vira `max × instâncias` — em cluster isso exigiria um store compartilhado (Redis). E o bucket é por IP e compartilhado entre as rotas, então um cliente que satura a ingestão também barra o próprio callback se vier do mesmo IP (em deploy real o n8n vem de outro endereço).
  - **Impacto no teste de carga**: o cenário da Fase 9 excede o limite padrão de propósito. Para reproduzir os números do [`LOAD-TEST.md`](LOAD-TEST.md), suba o servidor com `RATE_LIMIT_MAX` alto.
- **[RESOLVIDO] Bypass de decisão via webhook do n8n**: o node `Webhook` agora exige *Header Auth* (`Authorization: Bearer <N8N_WEBHOOK_TOKEN>`) e o `N8nWebhookClient` envia essa credencial. Antes, quem alcançasse o container do n8n na rede postava direto no webhook e fazia o n8n — que possui a credencial válida do callback — alterar o status de qualquer transação, contornando a autenticação da API. Validado nos dois sentidos: o fluxo legítimo completa (`LOW`→`COMPLETED`, `HIGH`→`FAILED`) e a chamada sem credencial recebe `403`.
- **[RESOLVIDO] Perda de mensagem sem *dead-letter queue***: o `TransactionWorker` rejeita com `nack(msg, false, false)` em qualquer falha. O `requeue: false` continua intencional (evita reprocessar mensagem envenenada para sempre), mas agora a fila `transactions.queue` e declarada com `x-dead-letter-exchange`, entao a mensagem rejeitada vai para `transactions.queue.dead` em vez de sumir. O header `x-death` preserva o motivo (`rejected`) e a fila de origem, o que torna a mensagem investigavel e reprocessavel. Validado publicando JSON invalido: 5/5 mensagens chegaram na fila morta com conteudo intacto. O teste de carga da Fase 9 media 7.866 mensagens perdidas em 30s antes disso — ver [`LOAD-TEST.md`](LOAD-TEST.md).
  - **Atencao ao atualizar um ambiente existente**: o RabbitMQ recusa `assertQueue` com argumentos diferentes dos da fila ja criada, e o app **nao sobe** (`406 PRECONDITION_FAILED - inequivalent arg 'x-dead-letter-exchange'`). Apague a fila antiga uma unica vez e reinicie: `docker compose exec rabbitmq rabbitmqctl delete_queue transactions.queue`. Isso descarta as mensagens que estiverem nela.
- **"Sucesso reportado como falha" em `ProcessTransactionUseCase.execute()`**: a transação é persistida no Oracle *antes* de publicar o evento (RabbitMQ) e gravar o audit log (Mongo), na ordem correta para evitar o "evento fantasma". Mas como as três chamadas (`save` → `publish` → `logTransaction`) estão em sequência com `await` direto e sem isolamento de erro, se o RabbitMQ ou o Mongo falharem *depois* do Oracle já ter persistido com sucesso, a exceção sobe do mesmo jeito e o cliente recebe `500` — mesmo com a transação realmente salva. Correção recomendada: isolar `publish`/`logTransaction` (ex.: `Promise.allSettled`, try/catch dedicado com log de severidade alta, ou mover para processamento assíncrono real via fila) para que uma falha de auditoria/evento não derrube a resposta de uma escrita síncrona que já teve sucesso.

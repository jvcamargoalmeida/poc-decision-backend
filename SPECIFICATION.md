# Especificação Técnica e Requisitos (poc-decision-backend)

Este documento descreve as capacidades do sistema, suas restrições arquiteturais, o ciclo de vida completo de uma transação e o mapeamento físico dos componentes no repositório.

## 1. Requisitos Funcionais (RF)
*Ações e comportamentos que o sistema deve executar.*

- **RF01 - Ingestão de Transações:** O sistema deve receber requisições HTTP POST contendo os dados básicos de uma transação financeira (valor e moeda).
- **RF02 - Cálculo de Risco Interno (Síncrono):** O sistema deve aplicar regras de negócio internas em tempo real para classificar o risco preliminar da transação com base no valor.
- **RF03 - Persistência Transacional:** O sistema deve salvar o registro estruturado da transação e seu risco preliminar em um banco de dados relacional (Oracle).
- **RF04 - Retorno de Baixa Latência:** O sistema deve retornar um *Acknowledge* (Status 201/202) para o cliente imediatamente após o salvamento no Oracle, sem esperar processamentos externos.
- **RF05 - Retenção de Payload Bruto:** O sistema deve salvar o payload original e metadados de auditoria em um banco NoSQL (MongoDB) para fins de *data lake* e compliance.
- **RF06 - Enfileiramento de Eventos:** O sistema deve publicar um evento de "Transação Criada" em um *message broker* (RabbitMQ) para processamento assíncrono.
- **RF07 - Integração de Decisão Externa:** O sistema deve consumir a fila de eventos e enviar os dados para um orquestrador externo (n8n) via Webhook.
- **RF08 - Atualização de Status (Callback):** O sistema deve possuir uma rota de *callback* para receber a decisão final do orquestrador externo e atualizar o status da transação no Oracle.
- **RF09 - Idempotência de Ingestão:** O sistema deve aceitar uma chave `Idempotency-Key` enviada pelo cliente e, quando a mesma chave for reapresentada, devolver a transação original em vez de criar uma nova — inclusive sob requisições concorrentes.
- **RF10 - Transporte Alternativo da Decisão (Fila):** O sistema deve suportar, de forma alternável por configuração, um segundo transporte em que o orquestrador externo **consome** o pedido de decisão diretamente de uma fila e **publica** o resultado em outra fila, sem webhook e sem rota de callback no caminho.

## 2. Requisitos Não Funcionais (RNF)
*Restrições, qualidade e características de engenharia do sistema.*

- **RNF01 - Alta Volumetria:** A camada de apresentação (Fastify) deve ser otimizada para altíssimo throughput.
- **RNF02 - Desacoplamento:** O banco de dados relacional não deve ser acessado via ORM; o controle de *connection pool* e queries SQL nativas é obrigatório para evitar overhead.
- **RNF03 - Resiliência:** Serviços externos (n8n) não podem bloquear a resposta principal da API (padrão *Fire and Forget* através de filas).
- **RNF04 - Observabilidade:** Todos os logs de aplicação devem ser gerados em formato estruturado (JSON estrito) para ingestão futura em APMs (Elastic/Datadog).
- **RNF05 - Qualidade de Código:** O projeto deve manter uma cobertura de testes unitários mínima de 95% (Vitest), imposta via CI/CD em todo Pull Request.
- **RNF06 - Autenticação de Callback:** A rota de callback, por alterar o estado final de uma transação, deve exigir credencial (*bearer token*) e rejeitar chamadas não autenticadas com `401`. A comparação do segredo deve ser feita em tempo constante para não vazar informação por *timing*.
- **RNF07 - Encerramento Gracioso:** Ao receber `SIGTERM`/`SIGINT`, a aplicação deve parar de aceitar trabalho novo (HTTP e consumo da fila) e fechar as conexões de Oracle, MongoDB e RabbitMQ antes de encerrar o processo, com limite de tempo para não travar indefinidamente.
- **RNF08 - Autenticação de Ingestão e Proteção contra Abuso:** `POST /transactions` deve exigir *bearer token* próprio, distinto do segredo do callback, e ambas as rotas de negócio devem estar sujeitas a limite de requisições por IP, respondendo `429` com `Retry-After`. O limite é contado **antes** da verificação de credencial, para que tentativas não autenticadas também consumam cota.
- **RNF09 - *Backpressure* na Decisão Externa:** O sistema não deve submeter o orquestrador externo a mais carga do que ele sustenta. Quando o orquestrador for interno e capaz de consumir do broker, o transporte por fila deve ser preferido, para que o ritmo seja ditado pelo consumidor (*pull*) e não pelo produtor (*push*).
- **RNF10 - Não Perda de Mensagem:** Toda fila deve declarar *dead-letter exchange*. Uma mensagem rejeitada — payload inválido, transação inexistente, falha do orquestrador — vai para a fila morta com o motivo preservado no header `x-death`, nunca é descartada silenciosamente.
- **RNF11 - Retry com *Backoff* antes do Descarte:** Falha transitória (indisponibilidade do orquestrador ou do banco) deve gerar nova tentativa com espera crescente antes de a mensagem ir para a fila morta. A espera é responsabilidade do *broker* (fila sem consumidor com `x-message-ttl`), não de temporizador na aplicação, para que a mensagem sobreviva à queda do processo. Falha definitiva — contrato violado, payload malformado, transação inexistente — não deve consumir tentativa.

> **Fora de escopo, deliberadamente:** identidade por cliente na trilha de auditoria. O audit log
> registra *o que* aconteceu, não *qual cliente* pediu — o token de ingestão é um segredo
> compartilhado. Resolver isso exigiria credencial por consumidor (ou JWT com `sub`) e um modelo de
> permissão, o que não tem relação com o objetivo desta PoC (estabilidade sob alta volumetria).
> Chegou a ser implementado e foi **removido** por ser desvio de escopo.

---

## 3. A Jornada da Transação (Mapeamento de Fluxo e Arquivos)

Abaixo está o ciclo de vida completo de uma transação, mapeando o comportamento às classes e arquivos específicos que você irá implementar.

As Fases A e B são iguais nos dois transportes. As Fases C, D e E existem em duas variantes: a de
webhook (`DECISION_TRANSPORT=http`, descrita em C/D/E) e a de fila
(`DECISION_TRANSPORT=queue`, descrita em C′/D′/E′).

### Fase A: Recepção e Persistência Síncrona (A API Principal)
1. **Recepção e Validação:** O cliente faz um POST em `/transactions`, autenticado por *bearer token* e opcionalmente com o header `Idempotency-Key`.
   - *Arquivos:* `src/presentation/routes/transaction.routes.ts` e `src/presentation/controllers/TransactionController.ts`
2. **Orquestração Síncrona:** O Controller chama o Caso de Uso principal.
   - *Arquivo:* `src/application/use-cases/ProcessTransactionUseCase.ts`
3. **Cálculo de Risco:** O Domínio gera um ID único e executa a regra de cálculo de risco interno.
   - *Arquivo:* `src/domain/strategies/risk/AmountRiskStrategy.ts`
4. **Persistência Relacional:** A aplicação abre conexão com o Oracle, executa um `INSERT` nativo, commita e fecha a conexão.
   - *Arquivo:* `src/infrastructure/database/oracle/OracleTransactionRepository.ts`
5. **Retorno Síncrono:** A API devolve HTTP 201/202 para o cliente, finalizando o bloqueio da requisição.

### Fase B: Distribuição e Auditoria (Assíncrono)
1. **Log de Auditoria:** O Caso de Uso empacota os dados e grava no MongoDB.
   - *Arquivo:* `src/infrastructure/database/mongo/MongoAuditRepository.ts`
2. **Despacho para Fila:** O Caso de Uso publica a mensagem na fila do RabbitMQ.
   - *Arquivo:* `src/infrastructure/messaging/rabbitmq/RabbitMQPublisher.ts`

### Fase C: O Worker (Consumidor da Fila)
1. **Consumo em Background:** Um *listener* fica monitorando ativamente a fila no RabbitMQ.
   - *Arquivo:* `src/infrastructure/messaging/rabbitmq/workers/TransactionWorker.ts`
2. **Disparo Externo:** O Worker faz uma requisição HTTP disparando para o Webhook do n8n e aplica *ACK* na mensagem da fila.
   - *Arquivo:* `src/infrastructure/external/n8n/N8nWebhookClient.ts`

### Fase D: O Cérebro Externo (n8n)
1. **Processamento Visual:** O **n8n** recebe o Webhook e executa o fluxo visual (simulando motores de fraude/crédito).
   - *Artefato:* Fluxo exportado no n8n (`n8n-workflows/fraud-analysis.json`).
2. **Decisão:** O n8n define o status final ("Aprovado"/"Recusado").

### Fase E: O Callback (O Retorno)
1. **Recepção Inbound:** O n8n faz um `PATCH` autenticado (bearer token) para a nossa rota `/callback/transactions`.
   - *Arquivos:* `src/presentation/routes/callback.routes.ts` e `src/presentation/controllers/CallbackController.ts`
2. **Orquestração Final:** O sistema processa o callback.
   - *Arquivo:* `src/application/use-cases/UpdateTransactionStatusUseCase.ts`
3. **Atualização no Banco:** Execução do `UPDATE` transacional no Oracle.
   - *Arquivo:* `src/infrastructure/database/oracle/OracleTransactionRepository.ts`

---

## 3.1 Variante: Decisão Mediada pela Fila (`DECISION_TRANSPORT=queue`)

Nesta variante o broker media os **dois** sentidos: `poc → fila → n8n → fila → poc`. As Fases A e B
são idênticas às acima — o `RabbitMQPublisher` publica `transaction.created` do mesmo jeito, sem
saber qual transporte está ativo. O que muda é quem escuta.

### Fase C′: O n8n Consome (em vez de ser chamado)
1. **Consumo pelo Orquestrador:** o próprio n8n mantém um consumidor ativo na fila de pedidos `transactions.queue.decision.requests`, ligada a `amq.topic` pela routing key `transaction.created`. O `TransactionWorker` e o `N8nWebhookClient` **não são instanciados** neste modo, e `transactions.queue` fica **desligada** da exchange — só o transporte ativo recebe o evento, para que a fila ociosa não acumule pedidos que o outro transporte já decidiu.
   - *Artefato:* `n8n-workflows/fraud-analysis-queue.json` (node *RabbitMQ Trigger*)
   - *Arquivo:* topologia e vínculo condicional declarados em `src/server.ts`

### Fase D′: Decisão e Publicação do Resultado
1. **Processamento Visual:** mesmo `If` sobre `riskScore` do fluxo de webhook, lendo `$json.data.riskScore` — o envelope `{ eventName, timestamp, data }` chega igual pela fila.
2. **Publicação da Decisão:** em vez de um `HTTP Request` para o callback, o n8n publica `{ id, status }` em `amq.topic` com a routing key `transaction.decided`.
   - *Artefato:* `n8n-workflows/fraud-analysis-queue.json` (nodes *Publicar FAILED* / *Publicar COMPLETED*)

### Fase E′: Aplicação da Decisão (sem HTTP)
1. **Consumo do Resultado:** um worker dedicado consome `transactions.queue.decision.results`.
   - *Arquivo:* `src/infrastructure/messaging/rabbitmq/workers/DecisionResultWorker.ts`
2. **Revalidação de Contrato:** como não há JSON Schema do Fastify nesse caminho, o worker valida `id` e `status` contra `TransactionStatus` manualmente e faz `nack` sem requeue no que não passar (a mensagem vai para a *dead-letter queue*).
3. **Orquestração e Atualização:** daí em diante o caminho é **o mesmo** do callback HTTP — mesmo caso de uso, mesmo repositório, montados pelo mesmo `buildUpdateTransactionStatusUseCase(pool)`.
   - *Arquivos:* `src/application/use-cases/UpdateTransactionStatusUseCase.ts`, `src/infrastructure/database/oracle/OracleTransactionRepository.ts` e `src/presentation/container.ts`

Trocar de transporte **não** duplica regra de negócio: muda apenas o adaptador de entrada. É a
prova prática da inversão de dependência que o resto do documento descreve.

---

## 3.2 Requisitos Transversais (Mapeamento de Arquivos)

Os RNFs abaixo não pertencem a uma fase específica da jornada — atravessam várias. Ficam mapeados
aqui para que a especificação continue sendo um mapa arquivo-a-arquivo completo, e não só do
caminho feliz.

| Requisito | Onde vive | Observação |
| --- | --- | --- |
| **RNF04** — Observabilidade | `src/infrastructure/logger/winston.logger.ts` | JSON estrito, injetado em todas as camadas |
| **RNF06 / RNF08** — Autenticação | `src/presentation/middlewares/bearer-auth.ts` | `createBearerAuthHook` (callback, segredo único) e `createClientAuthHook` (ingestão, credencial por cliente) |
| **RNF08** — Rate limiting | `src/presentation/middlewares/rate-limit.ts` | hook `onRequest`, roda **antes** da autenticação |
| **RNF07** — Encerramento gracioso | `src/infrastructure/lifecycle/graceful-shutdown.ts` | ordem de teardown declarada em `src/server.ts` |
| **RNF09** — *Backpressure* | `src/server.ts` (chave `DECISION_TRANSPORT`) | não é código novo: é a escolha de quem consome a fila |
| **RNF10 / RNF11** — DLQ e retry | `src/infrastructure/messaging/rabbitmq/retry.ts` | topologia das filas de espera, `RetryScheduler` e `NonRetryableError`; consumido no branch de erro dos dois workers |
| **RF09** — Idempotência | `OracleTransactionRepository` (índice único + tradução do `ORA-00001`) e `ProcessTransactionUseCase` (curto-circuito e recuperação de corrida) | quem garante unicidade é o banco, não a verificação prévia |

O tratamento de erro global (`src/presentation/middlewares/error-handler.ts`) é o que converte os
erros de domínio em status HTTP — a fronteira que permite ao domínio não conhecer o protocolo de
transporte.

---

## 4. Testes de Carga e Validação Arquitetural (Stress Test)

O principal objetivo desta PoC é comprovar estabilidade sob alta volumetria. A validação não será feita por envios unitários (Postman/Insomnia), mas sim por injeção de carga massiva.

### 4.1. Ferramenta Utilizada
Utilizaremos o **Autocannon** (ferramenta baseada em Node.js desenvolvida pela mesma equipe do Fastify) para disparar concorrência extrema contra a API.

### 4.2. Cenário de Teste
O teste simulará um pico de requisições de Black Friday, bombardeando a Fase A do sistema.
**Comando de Execução (Exemplo):**

```bash
npx autocannon -c 100 -d 30 -m POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -b '{"amount": 15000, "currency": "BRL"}' \
  http://localhost:3000/transactions
```

Encapsulado em `npm run test:load`, que lê o token do `.env`. Como o cenário dispara ~515 req/s de
um único endereço, ele estoura qualquer limite de taxa realista — suba o servidor com
`RATE_LIMIT_MAX` alto, senão o teste mede o limitador em vez da aplicação.

### 4.3. Critérios de Aceite

| Critério | Resultado medido |
| --- | --- |
| Nenhuma resposta não-2xx na ingestão | ✅ 0 erros em ~15,5 mil requisições |
| Toda transação aceita gravada no Oracle | ✅ 15.562 linhas |
| Nenhuma mensagem perdida na decisão externa | ❌ na época, 7.866 descartadas — motivou a DLQ e o *rate limiting* |

O terceiro critério é o que justifica o RNF09 e o RNF10: a borda síncrona passou, o caminho
assíncrono não. Resultados completos e análise em [`LOAD-TEST.md`](LOAD-TEST.md).

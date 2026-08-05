# Diagramas de Arquitetura

Diagramas do sistema como ele está implementado hoje, derivados de
[`SPECIFICATION.md`](SPECIFICATION.md).

> **Sobre status de implementação:** este documento descreve *arquitetura*, não progresso.
> O que já está pronto vs. planejado é rastreado exclusivamente em [`ROADMAP.md`](ROADMAP.md) —
> uma versão anterior deste arquivo duplicava esse status em cada seção e envelheceu mal.

## 1. Arquitetura de Eventos

O ciclo de vida de uma transação tem duas metades. A **ingestão** (Fases A/B) é sempre a mesma.
A **decisão externa** (Fases C–E) tem dois transportes possíveis, escolhidos por
`DECISION_TRANSPORT` — comparados na seção 3.3.

### 1.1 Transporte `http` — o worker empurra a decisão

Ciclo completo com o n8n recebendo por webhook e devolvendo por callback HTTP.

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente
    participant API as Fastify API
    participant Risk as AmountRiskStrategy
    participant Oracle as Oracle DB
    participant Queue as RabbitMQ
    participant Mongo as MongoDB
    participant Worker as TransactionWorker
    participant N8n as n8n

    rect rgb(228, 241, 241)
    Note over Client,Mongo: Fase A/B — Ingestão (tudo dentro da requisição HTTP)
    Client->>API: POST /transactions {amount, currency}
    API->>Risk: calculateRisk(amount)
    Risk-->>API: RiskLevel
    API->>Oracle: INSERT (status=PENDING) RETURNING id
    Oracle-->>API: id gerado
    API->>Queue: publish(transaction.created)
    API->>Mongo: logTransaction(audit)
    API-->>Client: 201 Created
    end

    rect rgb(243, 235, 219)
    Note over Worker,N8n: Fase C/D — Decisão externa (assíncrono)
    Queue->>Worker: consume(transaction.created)
    Worker->>N8n: POST webhook
    N8n->>N8n: If riskScore == HIGH ? FAILED : COMPLETED
    N8n-->>Worker: 200 (decisão despachada)
    Worker->>Queue: publish(transaction.processed)
    Worker->>Queue: ack
    end

    rect rgb(241, 227, 227)
    Note over N8n,Oracle: Fase E — Callback (retorno da decisão)
    N8n->>API: PATCH /callback/transactions + Bearer token
    API->>API: valida credencial (timing-safe)
    API->>Oracle: findById + UPDATE status
    Oracle-->>API: ok
    API-->>N8n: 200
    end
```

Dois pontos de ordenação que são deliberados, não acidentais:

- **O `INSERT` no Oracle vem antes** do `publish` e do audit log. Publicar primeiro criaria um
  "evento fantasma": um evento anunciando uma transação que pode nunca ter sido persistida.
- **O worker chama o n8n antes** de republicar `transaction.processed`. O inverso anunciaria o
  processamento como concluído mesmo quando a decisão externa falhou.

`publish` e `logTransaction` rodam sob `Promise.allSettled`: quando eles executam, o Oracle já
confirmou a escrita, então uma falha de RabbitMQ ou Mongo é registrada com severidade alta mas
**não** vira `500` — o cliente recebe `201` porque a transação de fato existe. O custo assumido é
que uma falha de `publish` deixa a transação `PENDING` sem ninguém decidir — mitigado pelo retry
com *backoff* da seção 3.4, mas não eliminado: se o `publish` inicial falhar, nem a fila de retry
entra em cena, porque a mensagem nunca chegou ao broker.

### 1.2 Transporte `queue` — o n8n puxa da fila

Aqui a fila media os **dois** sentidos. A ingestão (Fase A/B) é idêntica; o que muda é tudo
depois dela: não existe webhook, não existe rota de callback no caminho, e o `TransactionWorker`
sequer é iniciado.

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente
    participant API as Fastify API
    participant Oracle as Oracle DB
    participant Req as fila decision.requests
    participant N8n as n8n (RabbitMQ Trigger)
    participant Res as fila decision.results
    participant Worker as DecisionResultWorker

    rect rgb(228, 241, 241)
    Note over Client,Req: Fase A/B — Ingestão (idêntica ao modo http)
    Client->>API: POST /transactions + Idempotency-Key
    API->>Oracle: INSERT (status=PENDING) RETURNING id
    API->>Req: publish(transaction.created)
    API-->>Client: 201 Created
    end

    rect rgb(243, 235, 219)
    Note over Req,N8n: Fase C/D — Decisão (o n8n consome no ritmo dele)
    N8n->>Req: consume (pull, 1 consumer)
    N8n->>N8n: If riskScore == HIGH ? FAILED : COMPLETED
    N8n->>Res: publish(transaction.decided)
    end

    rect rgb(241, 227, 227)
    Note over Res,Oracle: Fase E — Aplicação da decisão (sem HTTP)
    Res->>Worker: consume(transaction.decided)
    Worker->>Worker: valida id e status contra o enum
    Worker->>Oracle: UPDATE status
    Worker->>Res: ack (ou nack sem requeue → DLQ)
    end
```

A inversão de controle é o ponto todo: no modo `http` **nós** decidimos quando o n8n trabalha; no
modo `queue` **ele** decide, puxando quando tem capacidade. A fila absorve a diferença.

Duas consequências que não são cosméticas:

- **A validação de contrato muda de lugar.** No modo `http` o JSON Schema do Fastify rejeita um
  `status` fora do enum antes de qualquer código nosso rodar. Na fila não existe schema — por isso
  o `DecisionResultWorker` revalida `id` e `status` na mão e faz `nack` sem requeue no que não
  passar, mandando a mensagem para a *dead-letter queue* em vez de gravar lixo no Oracle.
- **A autenticação muda de natureza.** Some o *bearer token* das duas pontas e entra a credencial
  do broker. Quem publica em `transaction.decided` consegue alterar status — o controle de acesso
  passa a ser do RabbitMQ (usuário/vhost/permissão por exchange), não da nossa aplicação.

## 2. Contratos de Domínio e Implementações

O domínio define *ports* (interfaces); a infraestrutura fornece os *adapters*. Nenhuma classe de
domínio ou aplicação importa driver de banco, broker ou cliente HTTP.

```mermaid
classDiagram
    direction LR

    class Transaction {
        <<interface>>
        +string id?
        +number amount
        +string currency
        +TransactionStatus status
        +RiskLevel riskScore
        +string idempotencyKey?
        +Date createdAt
    }

    class IRiskStrategy {
        <<interface>>
        +calculateRisk(amount) RiskLevel
    }
    class ITransactionRepository {
        <<interface>>
        +save(transaction) Promise~Transaction~
        +findById(id) Promise~Transaction~ ou null
        +findByIdempotencyKey(key) Promise~Transaction~ ou null
        +updateStatus(id, status) Promise~void~
    }
    class IEventPublisher {
        <<interface>>
        +publish(event, payload) Promise~void~
    }
    class IAuditRepository {
        <<interface>>
        +logTransaction(id, payload, clientId?) Promise~void~
    }
    class IDecisionGateway {
        <<interface>>
        +requestDecision(transaction) Promise~void~
    }

    class AmountRiskStrategy
    class OracleTransactionRepository
    class RabbitMQPublisher
    class MongoAuditRepository
    class N8nWebhookClient

    class DomainError {
        <<abstract>>
    }
    class TransactionNotFoundError {
        +string transactionId
    }
    class DuplicateIdempotencyKeyError {
        +string idempotencyKey
    }

    IRiskStrategy <|.. AmountRiskStrategy
    ITransactionRepository <|.. OracleTransactionRepository
    IEventPublisher <|.. RabbitMQPublisher
    IAuditRepository <|.. MongoAuditRepository
    IDecisionGateway <|.. N8nWebhookClient
    DomainError <|-- TransactionNotFoundError
    DomainError <|-- DuplicateIdempotencyKeyError

    ITransactionRepository ..> Transaction
    IRiskStrategy ..> Transaction
```

`Transaction.id` é opcional porque a entidade existe em dois momentos: antes de persistir (sem
ID) e depois do `RETURNING id` do Oracle (com ID). O `ProcessTransactionUseCase` valida a
presença do ID logo após o `save` e falha explicitamente se ele não vier.

`DomainError` deliberadamente **não** carrega status HTTP — o domínio não conhece o protocolo de
transporte; o mapeamento erro → status acontece na camada de apresentação. `DuplicateIdempotencyKeyError`
existe justamente para manter essa fronteira: o `OracleTransactionRepository` traduz o `ORA-00001`
do driver nele, para que a camada de aplicação trate uma **corrida de idempotência** em vez de
conhecer códigos de erro do Oracle.

`IDecisionGateway` só tem implementação no modo `http`. No modo `queue` não existe adaptador de
saída para o n8n: a "chamada" ao orquestrador vira uma publicação na exchange, feita pelo mesmo
`IEventPublisher` que já publicava `transaction.created`. Um transporte a menos para manter.

## 3. Arquitetura do Sistema (C4)

### 3.1 Nível 1 — Contexto

Quem usa o sistema e com que sistemas externos ele conversa.

```mermaid
flowchart TB
    Client([Cliente / sistema consumidor])

    subgraph Boundary[" "]
        System["<b>poc-decision-backend</b><br/>Motor de processamento<br/>financeiro orientado a eventos"]
    end

    N8n["<b>n8n</b><br/>Orquestrador de decisão externo<br/>(simula engine de fraude/crédito)"]

    Client -->|"submete transação<br/>HTTP/JSON"| System
    System -->|"solicita decisão<br/>webhook HTTP"| N8n
    N8n -->|"devolve decisão<br/>callback autenticado"| System

    style Boundary fill:none,stroke:#888,stroke-dasharray:4 4
```

A separação importa: o cálculo de risco *preliminar* é interno e síncrono; a decisão *final* é
externa e assíncrona. É isso que permite responder ao cliente sem esperar o orquestrador.

### 3.2 Nível 2 — Contêineres

Visão das quatro camadas e da infraestrutura.

```mermaid
flowchart TB
    Client([Cliente])

    subgraph P["Presentation — Fastify"]
        TxRoute["POST /transactions"]
        CbRoute["PATCH /callback/transactions<br/>(bearer auth)"]
        ErrH["errorHandler global"]
    end

    subgraph A["Application — Use Cases"]
        ProcessUC["ProcessTransactionUseCase"]
        UpdateUC["UpdateTransactionStatusUseCase"]
    end

    subgraph D["Domain"]
        Strategy["AmountRiskStrategy"]
        Entity["Transaction / RiskLevel / TransactionStatus"]
        Errors["DomainError"]
    end

    subgraph I["Infrastructure"]
        OracleRepo["OracleTransactionRepository"]
        MongoRepo["MongoAuditRepository"]
        Publisher["RabbitMQPublisher"]
        Worker["TransactionWorker<br/>(só no modo http)"]
        DecWorker["DecisionResultWorker<br/>(só no modo queue)"]
        N8nClient["N8nWebhookClient"]
        Shutdown["graceful-shutdown"]
    end

    Oracle[(Oracle DB)]
    Mongo[(MongoDB)]
    Queue{{RabbitMQ}}
    N8n["n8n — fluxo visual"]

    Client -->|HTTP| TxRoute
    TxRoute --> ProcessUC
    ProcessUC --> Strategy
    ProcessUC --> OracleRepo
    ProcessUC --> Publisher
    ProcessUC --> MongoRepo
    OracleRepo --> Oracle
    MongoRepo --> Mongo
    Publisher --> Queue
    Queue --> Worker
    Worker --> N8nClient
    N8nClient -->|Webhook| N8n
    N8n -->|PATCH autenticado| CbRoute
    CbRoute --> UpdateUC
    Queue -."modo queue: pull".-> N8n
    N8n -."publica transaction.decided".-> Queue
    Queue -."modo queue".-> DecWorker
    DecWorker --> UpdateUC
    UpdateUC --> OracleRepo
    UpdateUC -.lança.-> Errors
    Errors -.mapeado por.-> ErrH
```

A dependência aponta sempre para dentro: `Presentation → Application → Domain`, com
`Infrastructure` implementando as interfaces do domínio. A montagem concreta (quem injeta o quê)
fica isolada no composition root em `src/presentation/container.ts`.

As linhas pontilhadas são o caminho alternativo do modo `queue`. Note que **os dois caminhos
convergem no mesmo `UpdateTransactionStatusUseCase`**: trocar o transporte não duplicou regra de
negócio nenhuma. É por isso que o composition root expõe
`buildUpdateTransactionStatusUseCase(pool)` — o `CallbackController` e o `DecisionResultWorker`
montam o mesmo caso de uso pelo mesmo caminho, cada um só traz o seu próprio adaptador de entrada.

### 3.3 Dois transportes para a decisão externa

A decisão do n8n pode trafegar por dois caminhos, alternados por `DECISION_TRANSPORT`.
A diferença que importa não é de tecnologia — é **quem controla o ritmo**.

```mermaid
flowchart LR
    subgraph H["DECISION_TRANSPORT=http (padrão)"]
        direction LR
        A1[API] --> Q1[[fila]] --> W1[TransactionWorker] -->|push HTTP| N1[n8n]
        N1 -->|PATCH callback| A1
    end

    subgraph Q["DECISION_TRANSPORT=queue"]
        direction LR
        A2[API] --> Q2[[fila de pedidos]]
        N2[n8n] -->|pull| Q2
        N2 --> Q3[[fila de resultados]] --> W2[DecisionResultWorker] --> A2
    end
```

| | `http` | `queue` |
| --- | --- | --- |
| Quem dita o ritmo | nosso worker **empurra** | o n8n **puxa** |
| Backpressure | inexistente — satura o n8n (6.552 `503` medidos) | natural: a fila segura o excedente |
| Pico de carga | mensagem descartada vai para a DLQ | trabalho fica enfileirado, aguardando |
| Validação do retorno | JSON Schema do Fastify na rota | manual, no `DecisionResultWorker` |
| Autenticação | bearer token nas duas pontas | credencial do broker |
| Acoplamento | n8n só precisa falar HTTP | n8n precisa de acesso ao broker |
| Componentes ativos | `TransactionWorker` + `N8nWebhookClient` + rota de callback | `DecisionResultWorker` |

### Topologia das filas

Uma única exchange `amq.topic` (durável) e três filas, todas com
`x-dead-letter-exchange` apontando para `transactions.queue.dlx`:

| Fila | Routing key | Consumidor | Ligada no modo |
| --- | --- | --- | --- |
| `transactions.queue` | `transaction.created` | `TransactionWorker` | `http` |
| `transactions.queue.decision.requests` | `transaction.created` | n8n, via *RabbitMQ Trigger* | `queue` |
| `transactions.queue.decision.results` | `transaction.decided` | `DecisionResultWorker` | `queue` |
| `transactions.queue.dead` | — (fanout da DLX) | nenhum — inspeção manual | ambos |

Como as filas se ligam por *routing key* e não por destinatário, o `RabbitMQPublisher` **não sabe
qual transporte está ativo** — ele publica `transaction.created` do mesmo jeito nos dois modos, e
quem muda é só quem está escutando. Trocar de transporte não tocou uma linha do publisher nem do
caso de uso.

**O vínculo é condicional ao transporte ativo.** As três filas são declaradas sempre (duráveis,
com a mesma DLX), mas o bootstrap liga à exchange só a fila que o modo atual consome e desliga a
do outro. Deixar as duas ligadas parece inofensivo — "a fila sem consumidor só acumula" —, mas o
`TransactionWorker` pede decisão ao n8n para **toda** mensagem que consome: ao voltar para `http`,
ele drenaria o acúmulo pedindo decisão de novo para transação já decidida, sobrescrevendo status
final. O `unbindQueue` é no-op quando o vínculo não existe, então o bootstrap continua idempotente.

### Qual usar

No código, a ausência da variável resolve para `http` — é o comportamento conservador, e é o que
se usa quando o orquestrador é **externo/SaaS**: não se entrega credencial de broker a terceiro,
e HTTP é o denominador comum que qualquer SaaS fala.

O `.env.example`, porém, já vem com `DECISION_TRANSPORT=queue`, porque nesta PoC o n8n é
**interno** (roda no mesmo `docker-compose`) — e nesse cenário o modo `queue` elimina de raiz a
saturação que o teste de carga mediu. Ou seja: o padrão do *código* é o seguro, o padrão do
*ambiente local* é o correto para esta topologia.

**Trocar de transporte exige reiniciar a aplicação**, já que a topologia é declarada no bootstrap.
A troca em si não perde mensagem: as filas continuam duráveis nos dois modos, só o vínculo com a
exchange muda. O que **não** é reversível sozinho é um acúmulo anterior — uma fila que ficou com
mensagens de antes do vínculo condicional precisa ser esvaziada uma vez
(`rabbitmqctl purge_queue`), senão o worker do modo de destino drena histórico já decidido.

### 3.4 Retry com backoff antes do descarte

Uma falha não vira descarte na primeira tentativa. Entre o worker e a fila morta existem filas de
espera — uma por nível de atraso — onde a mensagem fica parada até o broker devolvê-la sozinha.

```mermaid
flowchart LR
    Q[[fila de origem]] --> W[worker]
    W -->|sucesso| OK([ack])
    W -->|"falha transitória<br/>(n8n 503, Oracle fora)"| R1[[retry.1 · TTL 5s]]
    R1 -.TTL expira.-> Q
    W -->|"2ª falha"| R2[[retry.2 · TTL 30s]]
    R2 -.TTL expira.-> Q
    W -->|"3ª falha"| R3[[retry.3 · TTL 120s]]
    R3 -.TTL expira.-> Q
    W -->|"erro definitivo<br/>ou tentativas esgotadas"| DLQ[[dead-letter queue]]
```

Quatro decisões que sustentam esse desenho:

- **Quem agenda é o RabbitMQ, não a aplicação.** A fila de espera não tem consumidor: a mensagem
  vence por `x-message-ttl` e o broker a encaminha adiante. Um `setTimeout` no processo evaporaria
  junto com ele numa queda; a mensagem na fila sobrevive.
- **Uma fila por nível, não uma fila só com TTL por mensagem.** A expiração é avaliada na cabeça da
  fila, então uma mensagem de 120s na frente seguraria as de 5s atrás dela.
- **O retorno é pela exchange padrão** (`''`) com routing key igual ao nome da fila de origem — e
  **não** pela `amq.topic`. Voltar pela topic reentregaria a mensagem a toda fila ligada àquela
  routing key, não só à que falhou.
- **Nem toda falha merece nova tentativa.** JSON malformado, contrato violado e transação
  inexistente são `NonRetryableError` e vão direto para a fila morta: repetir gastaria o orçamento
  para chegar no mesmo lugar. Só falha de infraestrutura é reagendada.

O custo assumido é *at-least-once*: o worker republica a mensagem e só então confirma a original,
então uma queda exatamente nessa janela duplica a mensagem. Duplicar é preferível a perder — e é o
mesmo motivo pelo qual a ingestão aceita `Idempotency-Key`.

## 4. Modelo de Dados (DER)

A persistência é híbrida e **não** há chave estrangeira entre os dois bancos — o vínculo é lógico,
pela aplicação. Isso é deliberado: são tecnologias distintas, com propósitos distintos.

```mermaid
erDiagram
    TRANSACTIONS ||--o| AUDITLOGS : "referenciada por (vinculo logico)"

    TRANSACTIONS {
        VARCHAR2_32 id PK "DEFAULT SYS_GUID()"
        NUMBER_15_2 amount "NOT NULL"
        VARCHAR2_3 currency "NOT NULL"
        VARCHAR2_20 status "NOT NULL, DEFAULT PENDING"
        VARCHAR2_20 risk_score "NOT NULL"
        VARCHAR2_64 idempotency_key UK "NULL permitido, indice unico"
        TIMESTAMP created_at "NOT NULL, DEFAULT CURRENT_TIMESTAMP"
    }

    AUDITLOGS {
        ObjectId _id PK
        String transactionId UK "required, unique, index"
        Mixed payload "required"
        String clientId "opcional, index — quem originou"
        Date createdAt "default now"
    }
```

**Oracle — `transactions`** (fonte de verdade transacional, schema em
[`db/oracle/init/TRANSACTION.sql`](db/oracle/init/TRANSACTION.sql)): o `id` é gerado pelo banco
via `SYS_GUID()` e devolvido à aplicação pelo `RETURNING id INTO`. `status` e `risk_score` são
`VARCHAR2` livres no banco — as restrições de valor vivem nos enums `TransactionStatus` e
`RiskLevel` da aplicação, não em *check constraints*.

**MongoDB — `auditlogs`** (retenção de payload bruto, schema em
[`AuditLog.model.ts`](src/infrastructure/database/mongo/AuditLog.model.ts)): `payload` é
`Schema.Types.Mixed`, ou seja, guarda o documento como veio, sem impor forma — é o que se espera
de um *data lake* de compliance.

Dois pontos que valem atenção nesse modelo:

- **`transactionId` é `unique`** na coleção de auditoria, então existe no máximo **um** registro
  por transação. Hoje isso é consistente (só a criação é auditada), mas impede auditar eventos
  posteriores da mesma transação — auditar a mudança de status vinda do callback, por exemplo,
  falharia por chave duplicada. Se a auditoria evoluir para trilha de eventos, a unicidade precisa
  sair ou virar composta com o tipo de evento.
- **Sem *check constraint* em `status`/`risk_score`**: um `UPDATE` fora da aplicação pode gravar
  qualquer texto. A validação por enum acontece na borda HTTP (JSON Schema) e no TypeScript — e,
  no modo `queue`, na revalidação manual do `DecisionResultWorker`, já que ali não existe borda
  HTTP para o schema proteger.
- **`idempotency_key` usa *índice* único, não *constraint***: no Oracle um índice único admite
  múltiplos `NULL`s, então a chave continua opcional e as linhas antigas seguem válidas. É o banco
  — não a verificação prévia na aplicação — que resolve duas requisições concorrentes com a mesma
  chave; a aplicação só recupera a vencedora depois do `ORA-00001`.
- **`clientId` é indexado e opcional**: é o campo que responde "o que este cliente submeteu?", e a
  trilha só passa a ter essa resposta quando `API_CLIENTS` define credencial por cliente. Documentos
  gravados antes disso continuam válidos sem ele — daí ser opcional em vez de obrigatório.

---

*Diagramas mantidos manualmente — se um deles divergir do código, o código é a fonte de verdade.*

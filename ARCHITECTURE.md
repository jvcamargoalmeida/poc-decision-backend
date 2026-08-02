# Diagramas de Arquitetura

Rascunho para validação, gerado a partir de [`SPECIFICATION.md`](SPECIFICATION.md). O status
de cada componente (implementado vs. planejado) reflete [`ROADMAP.md`](ROADMAP.md) no momento
em que este documento foi escrito — pode ficar desatualizado; confira o roadmap para o estado atual.

## 1. Arquitetura de Eventos

A jornada completa de uma transação (Fases A–E da `SPECIFICATION.md`). O bloco "Fase A" é o
único trecho que bloqueia a resposta HTTP — tudo depois disso é *fire-and-forget* (RNF03).

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente
    participant API as Fastify API
    participant Risk as AmountRiskStrategy
    participant Oracle as Oracle DB
    participant Mongo as MongoDB
    participant Queue as RabbitMQ
    participant Worker as Transaction Worker
    participant N8n as n8n

    rect rgb(228, 241, 241)
    Note over Client,Oracle: Fase A — Ingestão síncrona (bloqueia a resposta)
    Client->>API: POST /transactions {amount, currency}
    API->>Risk: calculateRisk(amount)
    Risk-->>API: RiskLevel
    API->>Oracle: INSERT transaction (status=PENDING)
    Oracle-->>API: ack
    API-->>Client: 201/202 Created
    end

    rect rgb(236, 240, 233)
    Note over API,Queue: Fase B — Auditoria e distribuição (assíncrono)
    API->>Mongo: save(payload bruto + metadados)
    API->>Queue: publish(TransacaoCriada)
    end

    rect rgb(243, 235, 219)
    Note over Worker,N8n: Fase C/D — Decisão externa
    Queue->>Worker: consume(TransacaoCriada)
    Worker->>N8n: POST webhook
    N8n->>N8n: fluxo visual (fraude/crédito)
    Worker-->>Queue: ack
    end

    rect rgb(241, 227, 227)
    Note over N8n,Oracle: Fase E — Callback (retorno da decisão)
    N8n->>API: POST /callback/transactions {id, status}
    API->>Oracle: UPDATE status
    Oracle-->>API: ack
    end
```

**Status:** Fase A implementada em parte (`AmountRiskStrategy` completo; `OracleTransactionRepository`
é só esqueleto, sem `INSERT` real). Fases B–E ainda não têm código — publish no RabbitMQ, worker,
webhook e callback são trabalho futuro (ver `ROADMAP.md`, Fases 2–5).

## 2. Entidades e Domínio

Modelo de domínio tal como está codificado hoje em `src/domain` e
`src/infrastructure/database/oracle`. **Não** representa o schema físico do Oracle — essa
modelagem (tabelas, chaves, índices) é responsabilidade manual do engenheiro, fora do escopo de
geração por IA (ver `CLAUDE.md`).

```mermaid
classDiagram
    class Transaction {
        <<interface>>
        +string id
        +number amount
        +string currency
        +string status
        +RiskLevel riskScore
        +Date createdAt
    }

    class RiskLevel {
        <<enumeration>>
        LOW
        MEDIUM
        HIGH
    }

    class IRiskStrategy {
        <<interface>>
        +calculateRisk(amount) RiskLevel
    }

    class AmountRiskStrategy {
        +calculateRisk(amount) RiskLevel
    }

    class ITransactionRepository {
        <<interface>>
        +save(transaction) Promise
        +findById(id) Promise
    }

    class OracleTransactionRepository {
        -pool oracledb.Pool
        +save(transaction) Promise
        +findById(id) Promise
    }

    IRiskStrategy <|.. AmountRiskStrategy : implementa
    ITransactionRepository <|.. OracleTransactionRepository : implementa
    IRiskStrategy ..> Transaction : calcula risco de
    ITransactionRepository ..> Transaction : persiste
    Transaction *-- RiskLevel : riskScore
```

**Status:** `Transaction`, `RiskLevel`, `IRiskStrategy` e `AmountRiskStrategy` completos e testados
(100% de cobertura). `save`/`findById` em `OracleTransactionRepository` hoje contêm apenas
`// TODO` — nenhuma query SQL foi gerada por IA, por restrição explícita do `CLAUDE.md`.

## 3. Arquitetura do Sistema

Visão de contêineres (estilo C4) das quatro camadas de Clean Architecture e da infraestrutura
externa. Componentes sem `✅` ainda não têm arquivo correspondente em `src/`.

```mermaid
flowchart TB
    Client([Cliente])

    subgraph P["Presentation - Fastify"]
        Routes["Routes / Controllers<br/>POST /transactions<br/>POST /callback/transactions"]
    end

    subgraph A["Application - Use Cases"]
        ProcessUC["ProcessTransactionUseCase"]
        UpdateUC["UpdateTransactionStatusUseCase"]
    end

    subgraph D["Domain"]
        Strategy["AmountRiskStrategy ✅"]
        Entity["Transaction / RiskLevel ✅"]
    end

    subgraph I["Infrastructure"]
        OracleRepo["OracleTransactionRepository (esqueleto) ✅"]
        MongoRepo["MongoAuditRepository"]
        Publisher["RabbitMQPublisher"]
        Worker["TransactionWorker"]
        N8nClient["N8nWebhookClient"]
    end

    Oracle[(Oracle DB)]
    Mongo[(MongoDB)]
    Queue{{RabbitMQ}}
    N8n["n8n - fluxo visual"]

    Client -->|HTTP| Routes
    Routes --> ProcessUC
    ProcessUC --> Strategy
    ProcessUC --> OracleRepo
    ProcessUC --> MongoRepo
    ProcessUC --> Publisher
    OracleRepo --> Oracle
    MongoRepo --> Mongo
    Publisher --> Queue
    Queue --> Worker
    Worker --> N8nClient
    N8nClient -->|Webhook| N8n
    N8n -->|Callback HTTP| Routes
    Routes --> UpdateUC
    UpdateUC --> OracleRepo
```

**Status:** implementado — `AmountRiskStrategy`, `Transaction`/`RiskLevel`, esqueleto do
`OracleTransactionRepository`, e a conexão de pool do Oracle (`oracle.connection.ts`, não
representada acima por ser infraestrutura de baixo nível). Planejado — todo o resto: casos de
uso, controllers HTTP, repositório Mongo, publisher/worker do RabbitMQ e o cliente do n8n.

---

*Este documento é um rascunho gerado por IA a partir da `SPECIFICATION.md` para validação e
apresentação — revise cada diagrama e esteja pronto para explicar (e redesenhar, se preciso)
qualquer parte dele antes de usar em entrevista.*

# Diagramas de Arquitetura

Diagramas do sistema como ele está implementado hoje, derivados de
[`SPECIFICATION.md`](SPECIFICATION.md).

> **Sobre status de implementação:** este documento descreve *arquitetura*, não progresso.
> O que já está pronto vs. planejado é rastreado exclusivamente em [`ROADMAP.md`](ROADMAP.md) —
> uma versão anterior deste arquivo duplicava esse status em cada seção e envelheceu mal.
> Débitos técnicos conhecidos ficam na seção "Gaps Conhecidos" do roadmap.

## 1. Arquitetura de Eventos

Ciclo de vida completo de uma transação (Fases A–E da `SPECIFICATION.md`).

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

E um ponto que **contradiz o RNF03** e está registrado como gap no roadmap: `publish` e
`logTransaction` estão dentro da requisição HTTP com `await` direto, então uma falha no RabbitMQ
ou no Mongo devolve `500` ao cliente mesmo com a transação já gravada no Oracle. O
*fire-and-forget* real ainda não existe nessa borda.

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
        +updateStatus(id, status) Promise~void~
    }
    class IEventPublisher {
        <<interface>>
        +publish(event, payload) Promise~void~
    }
    class IAuditRepository {
        <<interface>>
        +logTransaction(id, payload) Promise~void~
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

    IRiskStrategy <|.. AmountRiskStrategy
    ITransactionRepository <|.. OracleTransactionRepository
    IEventPublisher <|.. RabbitMQPublisher
    IAuditRepository <|.. MongoAuditRepository
    IDecisionGateway <|.. N8nWebhookClient
    DomainError <|-- TransactionNotFoundError

    ITransactionRepository ..> Transaction
    IRiskStrategy ..> Transaction
```

`Transaction.id` é opcional porque a entidade existe em dois momentos: antes de persistir (sem
ID) e depois do `RETURNING id` do Oracle (com ID). O `ProcessTransactionUseCase` valida a
presença do ID logo após o `save` e falha explicitamente se ele não vier.

`DomainError` deliberadamente **não** carrega status HTTP — o domínio não conhece o protocolo de
transporte; o mapeamento erro → status acontece na camada de apresentação.

## 3. Arquitetura do Sistema

Visão de contêineres (estilo C4) das quatro camadas e da infraestrutura externa.

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
        Worker["TransactionWorker"]
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
    UpdateUC --> OracleRepo
    UpdateUC -.lança.-> Errors
    Errors -.mapeado por.-> ErrH
```

A dependência aponta sempre para dentro: `Presentation → Application → Domain`, com
`Infrastructure` implementando as interfaces do domínio. A montagem concreta (quem injeta o quê)
fica isolada no composition root em `src/presentation/container.ts`.

---

*Diagramas mantidos manualmente — se um deles divergir do código, o código é a fonte de verdade.*

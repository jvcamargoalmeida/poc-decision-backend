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

## 2. Requisitos Não Funcionais (RNF)
*Restrições, qualidade e características de engenharia do sistema.*

- **RNF01 - Alta Volumetria:** A camada de apresentação (Fastify) deve ser otimizada para altíssimo throughput.
- **RNF02 - Desacoplamento:** O banco de dados relacional não deve ser acessado via ORM; o controle de *connection pool* e queries SQL nativas é obrigatório para evitar overhead.
- **RNF03 - Resiliência:** Serviços externos (n8n) não podem bloquear a resposta principal da API (padrão *Fire and Forget* através de filas).
- **RNF04 - Observabilidade:** Todos os logs de aplicação devem ser gerados em formato estruturado (JSON estrito) para ingestão futura em APMs (Elastic/Datadog).
- **RNF05 - Qualidade de Código:** O projeto deve manter uma cobertura de testes unitários mínima de 95% (Vitest), imposta via CI/CD em todo Pull Request.

---

## 3. A Jornada da Transação (Mapeamento de Fluxo e Arquivos)

Abaixo está o ciclo de vida completo de uma transação, mapeando o comportamento às classes e arquivos específicos que você irá implementar.

### Fase A: Recepção e Persistência Síncrona (A API Principal)
1. **Recepção e Validação:** O cliente faz um POST em `/transactions`.
   - *Arquivos:* `src/presentation/http/routes/transaction.routes.ts` e `src/presentation/http/controllers/TransactionController.ts`
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
1. **Recepção Inbound:** O n8n faz um POST para a nossa rota `/callback/transactions`.
   - *Arquivos:* `src/presentation/http/routes/callback.routes.ts` e `src/presentation/http/controllers/CallbackController.ts`
2. **Orquestração Final:** O sistema processa o callback.
   - *Arquivo:* `src/application/use-cases/UpdateTransactionStatusUseCase.ts`
3. **Atualização no Banco:** Execução do `UPDATE` transacional no Oracle.
   - *Arquivo:* `src/infrastructure/database/oracle/OracleTransactionRepository.ts`

---

## 4. Testes de Carga e Validação Arquitetural (Stress Test)

O principal objetivo desta PoC é comprovar estabilidade sob alta volumetria. A validação não será feita por envios unitários (Postman/Insomnia), mas sim por injeção de carga massiva.

### 4.1. Ferramenta Utilizada
Utilizaremos o **Autocannon** (ferramenta baseada em Node.js desenvolvida pela mesma equipe do Fastify) para disparar concorrência extrema contra a API.

### 4.2. Cenário de Teste
O teste simulará um pico de requisições de Black Friday, bombardeando a Fase A do sistema.
**Comando de Execução (Exemplo):**
```bash
npx autocannon -c 100 -d 30 -m POST -H "Content-Type: application/json" -b '{"amount": 15000, "currency": "BRL"}' http://localhost:3000/transactions
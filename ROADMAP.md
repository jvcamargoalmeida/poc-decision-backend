# Roadmap de Desenvolvimento: poc-decision-backend

Acompanhamento das entregas e fases de implementação da Prova de Conceito (PoC). O projeto é orientado a Clean Architecture, suporta alta volumetria e utiliza persistência híbrida e orientada a eventos.

## Fase 1: Setup e Governança [Concluído]
- [x] Inicialização do projeto Node.js (TypeScript + Fastify).
- [x] Definição de diretrizes restritas de IA e arquitetura (`CLAUDE.md`).
- [x] Provisionamento de infraestrutura local via Docker Compose (Oracle, MongoDB, RabbitMQ, n8n).
- [x] Configuração do framework de testes (Vitest) com threshold obrigatório de 95% de cobertura.
- [x] Implementação de pipeline CI/CD (GitHub Actions) com branch protection.

## Fase 2: Core Domain e Casos de Uso [Em Andamento]
- [x] Modelagem de Entidades e Enums de Domínio (`Transaction`, `RiskLevel`).
- [x] Implementação do Design Pattern Strategy para regras de negócio e cálculo de risco.
- [x] Definição de Ports (Interfaces de Repositório).
- [x] Implementação manual das queries SQL nativas (INSERT com `RETURNING...INTO` + SELECT, bind variables) e mapeamento Row → Entity no `OracleTransactionRepository` (`save`/`findById`, gerenciamento de conexão via `try/finally`).
- [x] Implementação manual da orquestração real em `ProcessTransactionUseCase.execute()` (cálculo de risco via `IRiskStrategy` + persistência via `ITransactionRepository`).

## Fase 3: Camada de Apresentação (Presentation) [Concluído]

- [x] Criação de Controllers HTTP (`TransactionController`) e validação de payload (JSON Schema do Fastify, com `additionalProperties: false` reforçado via `removeAdditional: false` no AJV).
- [x] Configuração de Injeção de Dependências (IoC) para repositórios, strategies e casos de uso (composition root manual em `presentation/container.ts`).
- [x] Mapeamento de rotas Fastify (`POST /transactions`).
- [x] Implementação de Middleware global para tratamento de exceções (`setErrorHandler`, distingue erro de validação de erro interno).

## Fase 4: Processamento Assíncrono e Mensageria
- [ ] Implementação do Publisher RabbitMQ para roteamento de eventos.
- [ ] Implementação do Repositório MongoDB para retenção de logs de auditoria e payloads brutos.
- [ ] Desenvolvimento do Consumer/Worker RabbitMQ para processamento em background.

## Fase 5: Integração e Orquestração Externa (n8n)
- [ ] Desenvolvimento do serviço de integração via Webhooks (Outbound).
- [ ] Configuração do fluxo de aprovação e risco simulado no ambiente n8n.
- [ ] Implementação de rota de Callback (Inbound) para atualização de estado no Oracle.

## Fase 6: Observabilidade e Resiliência
- [ ] Configuração de Structured Logging com Winston (formato JSON estrito).
- [ ] Instrumentação de logs nos Casos de Uso e Workers.
- [ ] Implementação de rotinas de Graceful Shutdown (Bancos de dados e Message Broker).

## Fase 7: Qualidade e Testes (QA)
- [x] Testes unitários das estratégias de domínio (`AmountRiskStrategy`, 100% de cobertura).
- [x] Testes unitários do repositório Oracle (`OracleTransactionRepository`: `save`/`findById`, incluindo tratamento de erro do driver e não vazamento de conexão).
- [x] Testes unitários dos casos de uso (`ProcessTransactionUseCase`, aplicando mocks de `ITransactionRepository`/`IRiskStrategy`).
- [ ] Testes unitários da camada de apresentação e controllers (`TransactionController`, `CallbackController`).
- [x] Validação de aderência ao threshold de 95% em pipeline (gate ativo desde a Fase 1).

## Fase 8: Documentação Arquitetural
- [ ] Modelagem do Diagrama Entidade-Relacionamento (DER).
- [ ] Mapeamento de Arquitetura em Modelo C4 (Contexto e Contêiner).
- [ ] Diagrama de Sequência de Transações (API -> Fila -> n8n -> Banco).

## Fase 9: Testes de Carga e Validação Arquitetural
*Ver `SPECIFICATION.md`, seção 4.*
- [ ] Cenário de carga com Autocannon simulando pico de requisições contra `POST /transactions`.
- [ ] Validação de estabilidade da Fase A (ingestão síncrona) sob concorrência extrema.
- [ ] Registro dos resultados (throughput, latência p95/p99) como evidência de aderência ao RNF01.

## Gaps Conhecidos (Débito Técnico Documentado)

- **Idempotência / "phantom row" no `OracleTransactionRepository.save()`**: o INSERT roda com `autoCommit: true`; se a leitura do `outBinds` falhar *depois* do commit (ex.: driver não retornar o bind de saída por algum motivo), a linha já foi persistida no Oracle mas o método lança erro e o chamador recebe uma falha — a transação existe no banco sem que a aplicação saiba o ID gerado. Não há chave de idempotência nem constraint única para permitir um retry seguro (reconciliar com o registro já existente em vez de duplicar). Correção recomendada: introduzir uma idempotency key (gerada pelo client ou pelo `ProcessTransactionUseCase`) com constraint única na tabela e um `findByIdempotencyKey` de apoio, em vez de tratar o sintoma reativamente dentro de `save()`.

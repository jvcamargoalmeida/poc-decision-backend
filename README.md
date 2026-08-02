# 🚀 poc-decision-backend

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
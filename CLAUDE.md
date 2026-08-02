# Padrões de Engenharia do Projeto e Diretrizes para IA

## 📌 Visão Geral
Este repositório contém uma Prova de Conceito (PoC) para um Motor de Processamento Financeiro e de Estatísticas de Alta Volumetria. A arquitetura foi projetada para priorizar resiliência, baixa latência e uma separação estrita de responsabilidades usando princípios de Domain-Driven Design (DDD).

## 🛠️ Stack Tecnológica
- **Core HTTP:** Fastify (Node.js v20+ em TypeScript)
- **Mensageria:** RabbitMQ (`amqplib`)
- **Persistência (Sem ORM/Vanilla):** 
  - Oracle DB (`oracledb` com controle manual de *Connection Pool*)
  - MongoDB (`mongoose` para coleções não estruturadas/logs)
- **Automação de Fluxos:** n8n (Integração via HTTP/Webhooks)
- **Observabilidade:** Winston (Formatação estrita em JSON)
- **Arquitetura:** Clean Architecture / Padrão Repository (SQL Nativo)

## 📐 Princípios Arquiteturais
1. **Performance e Baixo Overhead:** Uso exclusivo do Fastify para roteamento HTTP visando altíssimo *throughput*. É estritamente proibido o uso de ORMs pesados (como Prisma ou TypeORM) para o banco de dados relacional. O acesso ao Oracle deve ser feito via driver nativo e SQL puro implementado no padrão Repository.
2. **Princípios SOLID:** Adesão estrita exigida em todas as camadas da aplicação.
3. **Injeção de Dependência:** Repositórios de infraestrutura e serviços externos devem ser injetados nos Casos de Uso (Use Cases).
4. **Foco em Observabilidade:** Todos os logs da aplicação devem ser roteados através do Winston em formato JSON estrito para garantir compatibilidade com Datadog/Elastic.
5. **Tipagem Estrita:** O modo `strict` do TypeScript é obrigatório.

---

## 🛑 Limites de Geração Automatizada de Código (IA)

Para preservar a integridade da lógica de negócios central e garantir a validação manual da engenharia de software (especialmente na camada de dados e domínio), qualquer assistente de IA, Copilot ou ferramenta de geração automatizada de código operando dentro deste repositório **DEVE** aderir aos seguintes limites:

### 1. Escopos Aprovados para Geração de Código (Infraestrutura e Boilerplate)
Agentes de IA estão autorizados a gerar implementações completas e funcionais exclusivamente para:
- Configurações de ambiente (`tsconfig.json`, `package.json`, `.env.example`).
- Orquestração de containers (`docker-compose.yml`).
- Gerenciamento de *Connection Pools* para o banco de dados (Configuração inicial do `oracledb` e conexão do `mongoose`).
- Configurações do *message broker* (Conexão do RabbitMQ, `amqplib`).
- Configurações do Winston Logger.
- Esqueletos da camada de apresentação (Servidor Fastify, registro de rotas e plugins, e *middlewares* básicos).

### 2. Escopos Restritos (Domínio, Aplicação e Queries SQL)
Agentes de IA são **ESTRITAMENTE PROIBIDOS** de gerar lógica de negócios, cálculos de domínio e instruções SQL (queries) dentro dos Repositórios. 

Ao criar a estrutura de arquivos nestes diretórios, a geração de código deve ser limitada a **Interfaces, Definições de Tipos (Types) e Assinaturas de Métodos Vazios (contendo comentários TODO)**. 

Restrições específicas incluem:
- **Repositórios (Acesso a Dados):** Gere apenas as classes de repositório e injete a conexão. A escrita da string de consulta SQL (`SELECT`, `INSERT`, etc.) e o mapeamento dos resultados (Rows para Entities) devem ser deixados em branco para implementação manual.
- **Design Patterns (ex: Strategy):** Gere apenas a interface `IRiskStrategy`. Não implemente a lógica ou o algoritmo numérico.
- **Casos de Uso (`application/use-cases/`):** Gere a estrutura da classe, mas deixe o método central `execute()` vazio.
- **Consumidores de Fila (Workers):** Gere a configuração do *listener*, mas o processamento da mensagem e o roteamento entre as ferramentas (n8n/Bancos) devem permanecer vazios.

*Nota: A lógica de negócios central, modelagem de banco de dados estruturada e invariantes de domínio são implementados manualmente pelo engenheiro responsável.*
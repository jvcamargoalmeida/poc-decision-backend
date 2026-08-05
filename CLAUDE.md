# Padrões de Engenharia do Projeto e Diretrizes para IA

## 📌 Visão Geral
Este repositório contém uma Prova de Conceito (PoC) para um Motor de Processamento Financeiro e de Estatísticas de Alta Volumetria. A arquitetura foi projetada para priorizar resiliência, baixa latência e uma separação estrita de responsabilidades usando princípios de Domain-Driven Design (DDD).

Os requisitos funcionais/não funcionais (RF/RNF) e o mapeamento arquivo-a-arquivo de cada fase da transação (API → Oracle → MongoDB → RabbitMQ → n8n → Callback) são a fonte de verdade em [`SPECIFICATION.md`](SPECIFICATION.md). O progresso de implementação é rastreado em [`ROADMAP.md`](ROADMAP.md). Qualquer geração de código pela IA nos arquivos citados na `SPECIFICATION.md` continua sujeita aos limites da seção "Limites de Geração Automatizada de Código" abaixo.

## 🛠️ Stack Tecnológica
- **Core HTTP:** Fastify (Node.js v20+ em TypeScript)
- **Mensageria:** RabbitMQ (`amqplib`)
- **Persistência (Sem ORM/Vanilla):** 
  - Oracle DB (`oracledb` com controle manual de *Connection Pool*)
  - MongoDB (`mongoose` para coleções não estruturadas/logs)
- **Automação de Fluxos:** n8n — dois transportes alternáveis por `DECISION_TRANSPORT`: HTTP/Webhooks (*push*) ou consumo direto da fila pelo próprio n8n (*pull*)
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

### 3. Exceções Concedidas Explicitamente

As restrições acima são o padrão. O engenheiro responsável pode suspendê-las pontualmente, e nesse caso **a exceção fica registrada aqui** — o objetivo da regra é rastreabilidade de autoria, não cerimônia. Uma exceção vale só para o escopo declarado; não abre precedente para os itens seguintes.

| Escopo | Concedida em | Motivo |
| --- | --- | --- |
| Implementação completa da idempotência (`ProcessTransactionUseCase`, `OracleTransactionRepository.findByIdempotencyKey`, `DuplicateIdempotencyKeyError`, DDL do índice único) | a pedido explícito do engenheiro, durante a resolução dos gaps de débito técnico | tratamento de corrida em nível de banco, com trade-offs que valiam ser demonstrados por inteiro em vez de esqueleto |
| Implementação completa do `DecisionResultWorker` (parse, revalidação de contrato e roteamento da mensagem) | Fase 10 | é o par simétrico do `CallbackController`, que já existia; a lógica de decisão em si continua no n8n, não no worker |
| Retry com *backoff* (`retry.ts` e a classificação de falha no branch de erro dos dois workers) | fechamento dos gaps em aberto | é resiliência de infraestrutura e topologia de broker — escopo já aprovado —, e não toca regra de negócio: o worker continua sem decidir nada sobre a transação, só sobre a entrega da mensagem |

Fora destas linhas, a restrição segue valendo integralmente.

### 4. Requisito não se escreve depois do código

Uma exceção autoriza **gerar código**; ela não autoriza inventar o requisito que o justifica. Se um
agente propõe algo que a [`SPECIFICATION.md`](SPECIFICATION.md) não pede, o caminho é propor a
mudança de escopo **antes** e deixar o engenheiro decidir — não implementar e depois acrescentar um
RF/RNF descrevendo o que já foi feito.

Isso já aconteceu neste repositório: a atribuição de identidade por cliente foi implementada e
ganhou um "RNF12" escrito depois, para descrevê-la. Foi revertida — o registro completo está na
"Nota de Escopo" ao fim do [`ROADMAP.md`](ROADMAP.md). O sintoma a vigiar é um gap que o próprio
agente documenta e em seguida fecha, tratando a lista de pendências dele como se fosse escopo do
projeto.

---

## 🚦 CI/CD e Cobertura de Testes

### Ferramenta de Testes
- **Framework:** [Vitest](https://vitest.dev/) com provider de cobertura `@vitest/coverage-v8`.
- **Configuração:** `vitest.config.mts`, na raiz do projeto.
- **Scripts:** `npm test` (execução única), `npm run test:watch` (modo watch) e `npm run test:coverage` (execução com relatório de cobertura).

### Gate de Cobertura (95%)
Todo Pull Request para a branch `main` **DEVE** manter cobertura mínima de **95%** nas quatro métricas (statements, branches, functions e lines), configurada em `coverage.thresholds` no `vitest.config.mts`. O comando `vitest run --coverage` falha (exit code não-zero) automaticamente se qualquer métrica ficar abaixo do limiar — esse é o mecanismo real de enforcement, não apenas uma checagem informativa.

`src/server.ts` (bootstrap fino que chama `app.listen`) é excluído da cobertura por não ter valor de teste unitário; ao ganhar lógica própria, deve ser removido da exclusão em `coverage.exclude`.

### Pipeline (GitHub Actions)
Definido em `.github/workflows/ci.yml`, disparado em todo `pull_request` (aberta, sincronizada ou reaberta) contra `main` e em todo `push` para `main`:
- **`quality`:** `npm run typecheck` (`tsconfig.json`, cobre `src/` + `tests/` — é o config que o editor também enxerga), `npm run build` (`tsconfig.build.json`, restrito a `src/` para o `dist/`), e um smoke test do `npm run dev` (sobe o `ts-node-dev`, faz polling em `/health` por até 15s) com Oracle, MongoDB e RabbitMQ como *service containers*.
  - O smoke test faz `cp .env.example .env` em vez de duplicar variável por variável no workflow. Isso é deliberado: **toda variável nova adicionada ao `.env.example` passa a existir automaticamente no CI**. Antes, cada variável nova quebrava o job até alguém lembrar de replicá-la — aconteceu três vezes seguidas. O efeito colateral é que o smoke test roda no transporte que o `.env.example` declara (hoje, `queue`).
- **`test`:** `npm run test:coverage`, publica um resumo de cobertura no Job Summary e como comentário atualizável na PR, e sobe o relatório completo (`coverage/`) como artefato.
- **`docker-compose-lint`:** valida a sintaxe do `docker-compose.yml` (`docker compose config`).
- **`ci-status`:** job agregador que falha se qualquer um dos anteriores falhar — é o único *required status check* necessário na proteção de branch do `main`.

O merge da PR só deve ser liberado no GitHub (Settings → Branches → Branch protection rules) com `ci-status` marcado como *required*. Configuração de proteção de branch não é versionada em arquivo — precisa ser aplicada manualmente (ou via `gh api`) no repositório.

### Fixação do TypeScript (`ts-node-dev` sem manutenção)
`ts-node-dev`/`ts-node` (usados em `npm run dev`) não recebem atualização desde 2022 e não suportam majors novos do TypeScript — um bump para o TS 7.x quebra `npm run dev` (`TypeError` dentro do `ts-node`) mesmo com `typecheck`/`build`/`test` passando normalmente, pois nenhum deles exercita o `ts-node-dev`. Por isso `typescript` fica travado em `^6.0.3` (não `^7.x`) até o projeto migrar para uma ferramenta de dev mantida (ex.: `tsx`) ou `ts-node-dev` ganhar suporte ao TS 7. O smoke test do `npm run dev` no job `quality` existe justamente para pegar esse tipo de quebra antes do merge.

### Atualização de Dependências (sem Dependabot)
O projeto **não usa Dependabot** (removido — `.github/dependabot.yml` não existe mais). Na prática, ele abriu ~11 PRs de uma vez na primeira execução, incluindo majors que quebram compatibilidade (`amqplib` 0.10→2.0, `fastify` 4→5, `oracledb` 6→7, `typescript` 6→7), e o volume de PRs/merges em sequência rápida chegou a saturar a fila de runners do GitHub Actions — mais atrapalho que ajuda para um projeto deste tamanho. Atualizações de dependência devem ser feitas manualmente (`npm outdated`, bump deliberado + validação local completa antes de commitar), uma de cada vez.

### Restrição para Testes Gerados por IA
As mesmas restrições da seção **"Escopos Restritos"** acima se aplicam à escrita de testes: agentes de IA podem escrever testes unitários completos para código de infraestrutura/apresentação (escopo aprovado), mas **não devem** inventar expectativas de regras de negócio para código de domínio/aplicação que não foi implementado por eles. Testes para lógica de negócio manual são responsabilidade do engenheiro responsável — a cobertura desse código, contudo, ainda conta para o gate de 95%.

---

## 🏷️ Commits, Labels e Quando Dispensar Branch

### Prefixos de commit → Labels de PR
Commits seguem o formato `tipo: descrição`. Cada tipo usado nos commits de uma PR **DEVE** ter a label correspondente aplicada na PR, sem precisar de ação manual do engenheiro:

| Prefixo do commit | Label da PR |
| --- | --- |
| `feat` | `feature` |
| `fix` | `fix` |
| `chore` | `chore` |
| `ci` | `ci` |
| `docs` | `docs` |
| `test` | `test` |
| `revert` | `revert` |

Regras:
- Uma PR com commits de mais de um tipo recebe todas as labels correspondentes.
- Se surgir um prefixo novo ainda não mapeado nesta tabela (ex.: `refactor`, `perf`, `build`), a label correspondente deve ser criada no momento (mesmo nome do prefixo) e esta tabela deve ser atualizada com a nova entrada. `revert` já passou por isso — entrada acrescentada quando o primeiro commit desse tipo apareceu numa PR.
- Aplicar a label depende de acesso de escrita à API do GitHub (`gh` autenticado ou token equivalente); sem isso, a label deve ao menos ser sinalizada explicitamente para aplicação manual.

### Quando um commit dispensa branch nova
Mudanças triviais e isoladas — sem risco, sem lógica nova, que não alteram comportamento de build/runtime (ex.: um ajuste pontual de documentação, uma correção de digitação, um comentário em arquivo de config) — podem ser commitadas **direto na `main`** como `chore`, sem precisar de branch/PR dedicada. Branches novas ficam reservadas para trabalho de fato substancial: features, fixes com lógica, mudanças de infraestrutura/CI ou qualquer coisa que passe pelo gate de cobertura/CI.

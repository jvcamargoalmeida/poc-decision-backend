# Teste de Carga — Resultados

Evidência para o **RNF01 (Alta Volumetria)**, conforme cenário definido na
[`SPECIFICATION.md`](SPECIFICATION.md), seção 4.

## Como reproduzir

```bash
docker compose up -d          # Oracle, MongoDB, RabbitMQ, n8n
npm run build && npm start    # build compilado, não ts-node-dev
npm run test:load
```

O teste roda contra o **build compilado** (`node dist/server.js`), não contra o `ts-node-dev` —
medir o servidor de desenvolvimento mediria o overhead de transpilação em vez da aplicação.

## Ambiente

| Item | Valor |
| --- | --- |
| Máquina | MacBook (Apple Silicon), stack completa em Docker Desktop |
| Oracle | `gvenzl/oracle-xe:slim` sob emulação `linux/amd64` |
| Pool Oracle | `ORACLE_POOL_MAX=10` (padrão do `.env.example`) |
| Cenário | `autocannon -c 100 -d 30` contra `POST /transactions` |
| Payload | `{"amount": 15000, "currency": "BRL"}` — risco `HIGH` |

> Os números abaixo são de execução local com todos os serviços concorrendo pelos mesmos
> recursos, incluindo Oracle emulado. Servem para comparar configurações e revelar gargalos,
> **não** como capacidade de produção.

## Resultado — ingestão síncrona (Fase A)

| Métrica | 100 conexões | 10 conexões (warm-up) |
| --- | ---: | ---: |
| Throughput médio | **515 req/s** | 774 req/s |
| Latência p50 | 108 ms | 7 ms |
| Latência p97.5 | 923 ms | 20 ms |
| Latência p99 | **1.947 ms** | 28 ms |
| Latência máx. | 4.247 ms | 3.753 ms |
| Requisições | ~15,5 mil em 30 s | 4 mil em 5 s |
| Respostas não-2xx | **0** | 0 |

**A camada HTTP não falhou:** nenhuma requisição foi recusada ou retornou erro, e todas as
15.562 transações foram efetivamente gravadas no Oracle.

### Contra-intuição: mais concorrência entregou *menos* throughput

Subir de 10 para 100 conexões **reduziu** o throughput (774 → 515 req/s) e multiplicou a p99 por
~70x. Isso é saturação, não capacidade extra. Duas causas prováveis, ambas verificáveis:

1. **Pool do Oracle limitado a 10 conexões.** Com 100 requisições simultâneas, 90 ficam
   esperando por uma conexão livre. O `Req/Sec` mínimo de **20** e o percentil de 1% em **0**
   mostram segundos inteiros de fila.
2. **`publish` e `logTransaction` estão dentro da requisição HTTP.** Cada request paga, em série,
   Oracle + RabbitMQ + MongoDB antes de responder. Isso é o gap "sucesso reportado como falha"
   já documentado no [`ROADMAP.md`](ROADMAP.md) — aqui ele aparece também como custo de latência.

## Achado principal: perda de mensagens sob carga

O gargalo real **não** foi a nossa API — foi o orquestrador externo.

| Erro no worker | Ocorrências |
| --- | ---: |
| `n8n respondeu 503` | 6.552 |
| `fetch failed` (conexão recusada) | 1.314 |
| **Total** | **7.866** |

O RabbitMQ absorveu o pico corretamente (chegou a ~7 mil mensagens enfileiradas e drenou depois),
mas o n8n não sustentou o ritmo e passou a responder `503`. Como o `TransactionWorker` faz
`nack(msg, false, false)` em qualquer falha, **essas 7.866 mensagens foram descartadas
definitivamente** — sem dead-letter queue, sem retry, sem trilha.

Estado final no Oracle, depois da fila drenar por completo:

| Status | Transações |
| --- | ---: |
| `FAILED` (decisão recebida) | 11.579 |
| `PENDING` (nunca decidida) | 7.913 |

Ou seja: **cerca de metade das transações aceitas com `201` nunca recebeu decisão**, e o cliente
não tem como saber disso. Do ponto de vista dele, todas foram aceitas com sucesso.

Isso valida empiricamente dois gaps que estavam documentados apenas como hipótese no
[`ROADMAP.md`](ROADMAP.md):

- **Ausência de dead-letter queue** — deixou de ser risco teórico e virou perda medida de 7.866
  mensagens numa única execução de 30 segundos.
- **Ausência de rate limiting** — nada protegeu o n8n de receber mais carga do que aguenta.

## Conclusão

O RNF01 é atendido **na borda síncrona**: a ingestão sustentou ~515 req/s com 100 conexões
concorrentes, sem recusar requisição e sem perder gravação no Oracle.

O sistema como um todo, porém, **não é resiliente sob a mesma carga**: a etapa de decisão externa
degrada silenciosamente e descarta trabalho. Antes de tratar esse número como capacidade real,
o mínimo seria dead-letter queue com retry, e rate limiting protegendo a integração externa.

Para melhorar o número da ingestão em si, o primeiro experimento óbvio é aumentar
`ORACLE_POOL_MAX` e tirar `publish`/`logTransaction` do caminho da requisição — nessa ordem,
medindo uma mudança de cada vez.

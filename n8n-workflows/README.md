# Workflows do n8n

Coloque aqui o(s) fluxo(s) exportado(s) do n8n (`.json`) — ex.: `fraud-analysis.json`, conforme
referenciado em [`SPECIFICATION.md`](../SPECIFICATION.md). Esta pasta é montada (leitura e
escrita, para o `export:workflow` conseguir gravar aqui) no container `n8n` (ver
`docker-compose.yml`) em `/n8n-workflows`.

## Dois fluxos, um por transporte

O repositório versiona **dois** workflows, um para cada valor de `DECISION_TRANSPORT` (ver
[`ARCHITECTURE.md`](../ARCHITECTURE.md#33-dois-transportes-para-a-decisão-externa)):

| Arquivo | Transporte | Como o n8n recebe/devolve |
| --- | --- | --- |
| `fraud-analysis.json` | `http` | `Webhook` recebe; `HTTP Request` devolve via callback |
| `fraud-analysis-queue.json` | `queue` | `RabbitMQ Trigger` consome; nodes `RabbitMQ` publicam o resultado |

Os dois ficam importados e publicados ao mesmo tempo — o `docker-compose.yml` não escolhe um com
base na variável. Quem decide qual roda de fato é o `DECISION_TRANSPORT` da aplicação: o outro
workflow fica publicado, mas ocioso, porque a fila que ele escuta (`transactions.queue` ou
`transactions.queue.decision.requests`) só está ligada à exchange quando esse é o transporte
ativo — o bootstrap em `src/server.ts` liga a exchange só à fila do transporte ativo e desliga a
do outro (subseção "Topologia das filas" em
[`ARCHITECTURE.md`](../ARCHITECTURE.md#33-dois-transportes-para-a-decisão-externa)).

## Como funciona (equivalente ao Oracle, via `entrypoint` customizado)

A imagem oficial `n8nio/n8n` **não tem um hook nativo** para importar workflows sozinha no boot
(diferente da `gvenzl/oracle-xe`, que roda scripts de `container-entrypoint-initdb.d/`
automaticamente). Para reproduzir o mesmo comportamento, o `docker-compose.yml` sobrescreve o
`entrypoint`/`command` do serviço `n8n`: antes de chamar `n8n start`, roda um script que importa
cada workflow **somente se** o arquivo existir e o marcador correspondente ainda não existir —
`/home/node/.n8n/.workflow-imported` para `fraud-analysis.json`,
`/home/node/.n8n/.queue-workflow-imported` para `fraud-analysis-queue.json`, ambos dentro do
volume `n8n-data`. Depois da primeira importação, o marcador garante que reinicializações
seguintes **não** reimportam — sem isso, cada restart reativaria a desativação do workflow (ver
nota abaixo).

**Sobre a ativação:** todo workflow importado entra **desativado**, mesmo que o JSON tivesse
`active: true` — a flag `--activeState=fromJson` do `import:workflow` só funciona em modo
*queue/multi-main*, que este projeto não usa. A saída é publicar logo depois de importar, com
`n8n publish:workflow --id=<id>`, e é o que o entrypoint faz. Detalhe que importa: a publicação
roda **antes** do `n8n start`; com o n8n já em execução, o próprio comando avisa que a mudança não
tem efeito até reiniciar.

## Exportar o fluxo (depois de editá-lo na UI do n8n)

1. Abra `http://localhost:5678` (UI do n8n) e edite/valide o fluxo.
2. Exporte **só esse workflow**, pelo `--id` (visível na URL ao abrir o fluxo) — com dois
   workflows vivendo na mesma instância, `export:workflow --all` misturaria os dois no mesmo
   arquivo:

   ```bash
   # fraud-analysis.json (transporte http)
   docker compose exec n8n n8n export:workflow --id=HzZSnB2P7GmjA1Zj --pretty \
     --output=/n8n-workflows/fraud-analysis.json

   # fraud-analysis-queue.json (transporte queue)
   docker compose exec n8n n8n export:workflow --id=QueueDecisionFlow01 --pretty \
     --output=/n8n-workflows/fraud-analysis-queue.json
   ```

3. Como a pasta é montada do host, o arquivo já aparece aqui, em `n8n-workflows/`, pronto para
   commitar.

## Credenciais de autenticação (automáticas)

Os dois fluxos juntos usam **três** credenciais:

| Credencial | Tipo | Quem usa | Protege |
| --- | --- | --- | --- |
| `Authorization` | Header Auth | node `Webhook` (`fraud-analysis.json`) | a **entrada** do modo `http`: só o nosso worker dispara o fluxo |
| `Callback Auth` | Bearer Auth | nodes `HTTP Request` (`fraud-analysis.json`) | a **saída** do modo `http`: autentica o callback na nossa API |
| `RabbitMQ account` | credencial nativa `rabbitmq` | nodes `RabbitMQ Trigger`/`RabbitMQ` (`fraud-analysis-queue.json`) | a entrada **e** a saída do modo `queue` — quem tem essa credencial pode ler pedidos e publicar decisões |

A primeira existe porque, sem ela, quem alcançasse o container do n8n na rede postaria direto no
webhook e faria o n8n — que possui a credencial válida do callback — alterar o status de qualquer
transação, contornando a autenticação da API. A terceira é o motivo pelo qual o modo `queue` só
faz sentido com um orquestrador **interno**: ela concede acesso de leitura/escrita ao broker, algo
que não se entrega a um SaaS de terceiro.

Credenciais **não** são exportadas junto com o workflow — ficam no volume `n8n-data`,
criptografadas, e o segredo nunca entra nos arquivos `.json` dos fluxos. Para que um ambiente novo
funcione mesmo assim, o `docker-compose.yml` materializa as credenciais no boot a partir de
[`credentials.template.json`](credentials.template.json): os placeholders
`__CALLBACK_AUTH_TOKEN__`, `__N8N_WEBHOOK_TOKEN__`, `__RABBITMQ_USER__` e `__RABBITMQ_PASSWORD__`
são substituídos pelos valores do `.env`, importados via `n8n import:credentials --decrypted`, e o
arquivo temporário é apagado em seguida. Dentro da rede do compose o host da credencial RabbitMQ é
o nome do serviço (`rabbitmq`), não `localhost`.

Só o template (com placeholder) é versionado — o segredo vive apenas no `.env`, que está no
`.gitignore`.

Diferente do workflow, as credenciais são **re-sincronizadas a cada boot** (a importação é
idempotente pelo ID). Isso é proposital: trocar um token no `.env` e reiniciar o container basta
para propagar o novo segredo.

Os `id` do template (`7EqVVyDtd0zkQhyZ`, `TdfPeTAlgECyHPr9` e `RabbitMQCredential1`) precisam
continuar batendo com o que os nodes referenciam nos arquivos de workflow — se recriar uma
credencial do zero pela UI, o n8n gera um ID novo e o template precisa ser atualizado junto.

## Os dois tipos de credencial não funcionam igual

Esta é a pegadinha mais cara deste setup, e o motivo de o `credentials.template.json` existir com
os valores já no formato certo:

| Tipo | Usado por | O que vai no campo de valor |
| --- | --- | --- |
| **Header Auth** (`httpHeaderAuth`) | node `Webhook` | o valor **completo** do header: `Bearer <token>` |
| **Bearer Auth** (`httpBearerAuth`) | nodes `HTTP Request` | **só o token** — o n8n adiciona `Bearer ` sozinho |

Colocar `Bearer <token>` num campo de *Bearer Auth* faz o n8n enviar
`Authorization: Bearer Bearer <token>`, e a API responde `401 Credencial inválida` — sem nenhuma
pista óbvia de que o problema é um prefixo duplicado.

**Edições pela UI são sobrescritas.** As credenciais são re-sincronizadas a partir do `.env` a
cada boot do container. Se você ajustar uma credencial pela interface, a mudança vale até o
próximo restart. Para alterar de verdade, mude o `.env` (ou o template) e reinicie.

**`docker compose restart` não basta** quando o `docker-compose.yml` muda: `restart` reaproveita a
configuração antiga do contêiner, então variáveis novas não chegam. Use `docker compose up -d n8n`.

## Importar o fluxo (setup novo / próxima pessoa que clonar o projeto)

Totalmente automático: `docker compose up -d` importa **os dois** workflows, **publica** cada um
(`n8n publish:workflow`, executado antes do `n8n start` — publicar com o n8n já rodando não teria
efeito) e materializa as três credenciais a partir do `.env`. Um clone limpo sobe com o fluxo do
transporte escolhido em `DECISION_TRANSPORT` já funcionando, sem passo manual.

Para forçar a reimportação de um workflow específico (⚠️ o que estiver no volume é substituído; se
ele tiver mudanças não exportadas, elas se perdem), apague o marcador correspondente e reinicie o
container:

```bash
# fraud-analysis.json (transporte http)
docker compose exec n8n rm -f /home/node/.n8n/.workflow-imported

# fraud-analysis-queue.json (transporte queue)
docker compose exec n8n rm -f /home/node/.n8n/.queue-workflow-imported

docker compose restart n8n
```

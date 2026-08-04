# Workflows do n8n

Coloque aqui o(s) fluxo(s) exportado(s) do n8n (`.json`) — ex.: `fraud-analysis.json`, conforme
referenciado em [`SPECIFICATION.md`](../SPECIFICATION.md). Esta pasta é montada (leitura e
escrita, para o `export:workflow` conseguir gravar aqui) no container `n8n` (ver
`docker-compose.yml`) em `/n8n-workflows`.

## Como funciona (equivalente ao Oracle, via `entrypoint` customizado)

A imagem oficial `n8nio/n8n` **não tem um hook nativo** para importar workflows sozinha no boot
(diferente da `gvenzl/oracle-xe`, que roda scripts de `container-entrypoint-initdb.d/`
automaticamente). Para reproduzir o mesmo comportamento, o `docker-compose.yml` sobrescreve o
`entrypoint`/`command` do serviço `n8n`: antes de chamar `n8n start`, roda um script que importa
`fraud-analysis.json` **somente se** o arquivo existir e um marcador
(`/home/node/.n8n/.workflow-imported`, dentro do volume `n8n-data`) ainda não existir. Depois da
primeira importação, o marcador garante que reinicializações seguintes **não** reimportam — sem
isso, cada restart reativaria a desativação do workflow (ver nota abaixo).

**Importante:** no modo de deployment padrão (o deste `docker-compose.yml`, sem *queue/multi-main
mode*), todo workflow importado entra **desativado**, mesmo que o JSON original tivesse `active:
true` — não existe flag de CLI que ative automaticamente fora desses modos avançados. Depois do
primeiro `docker compose up -d` num ambiente novo (volume `n8n-data` vazio), abra
`http://localhost:5678`, encontre o workflow importado e ative manualmente pelo toggle na UI —
isso só precisa ser feito uma vez; o estado ativado persiste no volume depois disso.

## Exportar o fluxo (depois de criá-lo na UI do n8n)

1. Abra `http://localhost:5678` (UI do n8n) e construa/valide o fluxo.
2. Exporte o workflow (o comando abaixo exporta **todos** de uma vez; para exportar só um
   específico, use `--id=<ID> --output=/n8n-workflows/fraud-analysis.json`, com o ID visível na
   URL ao abrir o workflow):

   ```bash
   docker compose exec n8n n8n export:workflow --all --pretty --output=/n8n-workflows/fraud-analysis.json
   ```

3. Como a pasta é montada do host, o arquivo já aparece aqui, em `n8n-workflows/`, pronto para
   commitar.

## Credencial de autenticação (automática)

A rota `PATCH /callback/transactions` exige `Authorization: Bearer <CALLBACK_AUTH_TOKEN>` (ver
`.env.example`). Os dois nodes `HTTP Request` do fluxo enviam esse header através da credencial
`Callback Auth` (tipo *Bearer Auth*).

Credenciais **não** são exportadas junto com o workflow — ficam no volume `n8n-data`,
criptografadas, e o segredo nunca entra no `fraud-analysis.json`. Para que um ambiente novo
funcione mesmo assim, o `docker-compose.yml` materializa a credencial no boot a partir de
[`credentials.template.json`](credentials.template.json): o placeholder `__CALLBACK_AUTH_TOKEN__`
é substituído pelo valor de `CALLBACK_AUTH_TOKEN` do `.env`, importado via
`n8n import:credentials --decrypted`, e o arquivo temporário é apagado em seguida.

Só o template (com placeholder) é versionado — o segredo vive apenas no `.env`, que está no
`.gitignore`.

Diferente do workflow, a credencial é **re-sincronizada a cada boot** (a importação é idempotente
pelo ID). Isso é proposital: trocar `CALLBACK_AUTH_TOKEN` no `.env` e reiniciar o container basta
para propagar o novo segredo. O contraponto é que edições feitas manualmente nessa credencial pela
UI são sobrescritas no próximo restart.

O `id` no template (`7EqVVyDtd0zkQhyZ`) precisa continuar batendo com o que os nodes referenciam
no `fraud-analysis.json` — se recriar a credencial do zero pela UI, o n8n gera um ID novo e o
template precisa ser atualizado junto.

## Importar o fluxo (setup novo / próxima pessoa que clonar o projeto)

Automático: `docker compose up -d` já importa `fraud-analysis.json` sozinho na primeira vez que o
`n8n` sobe com o volume `n8n-data` vazio (ver mecanismo acima). Só falta ativar manualmente na UI
depois — é o único passo que continua manual, pela limitação do modo de deployment já explicada.

Para forçar uma reimportação (⚠️ o workflow atual no volume é substituído; se ele tiver mudanças
não exportadas, elas se perdem), apague o marcador e reinicie o container:

```bash
docker compose exec n8n rm -f /home/node/.n8n/.workflow-imported
docker compose restart n8n
```

# Scripts de Inicialização do Oracle

Coloque aqui os arquivos `.sql` (ou `.sh`) de modelagem do banco — `CREATE TABLE`, sequences/
identity columns, índices, etc. Esta pasta é montada no container `oracle-xe` (ver
`docker-compose.yml`) em `/container-entrypoint-initdb.d/`, o diretório de inicialização da
imagem [`gvenzl/oracle-xe`](https://github.com/gvenzl/oci-oracle-xe).

## Como funciona

- Os scripts rodam **automaticamente**, em ordem alfabética, na **primeira vez** que o container
  sobe com o volume `oracle-data` vazio (ou seja, só na criação inicial do banco).
- Prefixe os arquivos com números pra garantir a ordem de execução (ex.: `01_schema.sql`,
  `02_seed.sql`).
- Nenhum script é gerado automaticamente aqui — a modelagem de banco de dados (schema, chaves
  primárias, estratégia de geração de ID) é responsabilidade manual do engenheiro, conforme
  `CLAUDE.md`.

## Importante: volume já existe

Se você já rodou `docker compose up` antes neste projeto, o volume `oracle-data` já foi criado
e **os scripts novos não vão rodar sozinhos** — a imagem só executa a inicialização quando o
volume está vazio. Pra forçar a reinicialização (⚠️ isso apaga os dados do Oracle):

```bash
docker compose down -v
docker compose up -d
```

Confirme sempre com `docker compose logs -f oracle-xe` que os scripts realmente rodaram.

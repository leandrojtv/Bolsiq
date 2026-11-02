# market-data

Serviço de dados de mercado. É o produto principal: a API pública versionada
`/v1` que será vendida, concorrendo com a brapi.

Nenhum outro serviço acessa fonte externa de dados. Quem precisa de dado de
mercado chama este serviço.

## Estado atual

A base está de pé e verificada; os adapters de fonte ainda não.

| Parte                                              | Estado                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Monorepo, TypeScript estrito, Turborepo            | pronto                                                                  |
| Schema e migrations, com 4 hypertables             | pronto, aplicado em Postgres 17 + TimescaleDB                           |
| Fastify com `ROLE`, health e OpenAPI gerado do Zod | pronto                                                                  |
| pg-boss com filas e agenda                         | pronto, 6 jobs agendados em `America/Sao_Paulo`                         |
| Imagem Docker e compose                            | pronto, smoke passando                                                  |
| Adapters CVM, B3 e BCB                             | **não implementados** — as conversões existem em `@bolsiq/domain`       |
| Endpoints `/admin/jobs`                            | **não implementados**                                                   |
| Autenticação, planos e medição                     | **não implementados** — ver [ADR 0007](../adr/0007-gateway-e-planos.md) |

## Papéis: `ROLE`

Uma imagem, três modos ([ADR 0006](../adr/0006-jobs-no-proprio-servico.md)):

| `ROLE`   | Serve `/v1` | Serve `/v1/health` | Consome a fila |
| -------- | ----------- | ------------------ | -------------- |
| `api`    | sim         | sim                | não            |
| `worker` | **não**     | sim                | sim            |
| `all`    | sim         | sim                | sim            |

`ROLE` é validado por Zod na inicialização e **falha alto** se vier errado. O
ADR 0006 explica por quê: um `ROLE` digitado errado subiria dois `api` e nenhum
`worker`, e nada pareceria errado até o primeiro job agendado não rodar.

O `worker` serve `/v1/health` de propósito, mesmo não sendo API. Health é
observabilidade, não contrato: sem isso o `docker compose up --wait` declara o
worker unhealthy e o deploy falha sem que nada esteja errado. Esse erro
aconteceu de fato ao subir o compose pela primeira vez.

## Estrutura

```
services/market-data/
  src/
    config.ts          ROLE e ambiente, validados por Zod
    app.ts             aplicação Fastify (não abre porta: testável por inject)
    server.ts          ponto de entrada; decide o que sobe conforme ROLE
    worker.ts          pg-boss: filas e agenda
    jobs/registry.ts   definição dos jobs, cron, retry e expiração
    routes/specs.ts    rotas em Zod — fonte única do app e do OpenAPI
    openapi-generate.ts
```

Pacotes de que depende:

| Pacote              | Papel                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| `@bolsiq/contracts` | schemas Zod do contrato público, envelope de erro, gerador de OpenAPI |
| `@bolsiq/domain`    | conversões puras: decimal, CVM, BCB, COTAHIST                         |
| `@bolsiq/db-core`   | schema Drizzle, migrations e acesso ao Postgres                       |

## Schema

Schema `market_data`, um banco por serviço. Nenhum outro serviço lê estas
tabelas.

| Tabela                                 | Chave natural                                                               | Hypertable         |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------ |
| `assets`                               | `cnpj` (índice único em `ticker`)                                           | não                |
| `quotes_daily`                         | `(ticker, date)`                                                            | sim, chunk mensal  |
| `financial_statements`                 | `(cvm_code, reference_date, statement_type, is_consolidated, account_code)` | não                |
| `fund_daily`                           | `(cnpj_fundo, date)`                                                        | sim, chunk semanal |
| `macro_series`                         | `(series_code, date)`                                                       | sim, chunk anual   |
| `fetch_log`                            | `(source, source_ref, content_hash)`                                        | não                |
| `api_plans`, `api_clients`, `api_keys` | `id`                                                                        | não                |
| `api_usage`                            | `(key_id, ts, route)`                                                       | sim, chunk diário  |

A chave natural é o que torna o reprocessamento idempotente: rodar o mesmo job
duas vezes sobrescreve as mesmas linhas. O `fetch_log` é o outro nível, que
evita o reprocessamento. Ver
[reprocessar-fonte.md](../runbooks/reprocessar-fonte.md).

### Decisões que o schema impõe

- **Moeda em `numeric`, nunca `float`** (regra 5). No Drizzle isso aparece como
  `string` em TypeScript, e o contrato expõe string decimal — serializar como
  `number` reintroduziria o erro de ponto flutuante que o `numeric` existe para
  evitar.
- **`timestamptz` em UTC** (regra 5). Exibição em `America/Sao_Paulo` é da
  camada de apresentação.
- **Proveniência em toda tabela de dado de mercado** (regra 4): `source`,
  `fetched_at`, `license`, `source_ref`. O `license` não é enfeite — ele diz ao
  cliente o que pode redistribuir, e as fontes diferem radicalmente nisso. Ver
  [market-data-sources.md](market-data-sources.md).
- **A coluna de tempo está na chave primária** de toda hypertable, porque o
  TimescaleDB exige a coluna de particionamento em todo índice único.

### Migrations

`0000_schema_inicial.sql` é gerada pelo drizzle-kit a partir do schema
TypeScript. `0001_timescale.sql` é escrita à mão: o drizzle-kit não conhece
TimescaleDB. As chamadas de `create_hypertable` não afetam o diff do schema, e é
por isso que o check `migrations` do CI continua detectando drift corretamente.

O agregado contínuo de uso por chave por dia **ainda não existe**:
`CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)` não roda dentro de
transação, e o migrador do Drizzle envolve cada migration numa. Precisa de
tratamento próprio, e entra junto com `/v1/me/usage`.

Detalhe de ferramenta que custou tempo: o drizzle-kit carrega os arquivos de
schema em CJS e não resolve o sufixo `.js` que o NodeNext exige em import
relativo. Por isso o `drizzle.config.ts` lista os arquivos de schema um a um, em
vez de apontar para o `index.ts`, e `src/schema/api.ts` declara o seu próprio
`pgSchema("market_data")` em vez de importá-lo.

## Jobs e agenda

Horários em `America/Sao_Paulo`, passados ao pg-boss como fuso nomeado — não
como deslocamento. O Brasil não tem horário de verão hoje; se voltar, só o fuso
nomeado continua correto.

| Job                  | Agenda          |
| -------------------- | --------------- |
| `b3-cotahist-diario` | `30 19 * * 1-5` |
| `cvm-fundos`         | `0 6 * * *`     |
| `bcb-sgs`            | `0 6 * * *`     |
| `cvm-cadastro`       | `0 5 * * 1`     |
| `cvm-dfp`            | `30 5 * * 1`    |
| `cvm-itr`            | `0 6 * * 1`     |
| `b3-cotahist-anual`  | sob demanda     |
| `ajuste-proventos`   | sob demanda     |

Os handlers ainda não existem: a fila, a agenda e o retry com backoff estão de
pé, e é o que `/admin/jobs` vai consultar.

Pendência conhecida: a agenda das 19:30 em dias úteis não conhece o calendário
de feriados da B3. Em feriado o download devolve 404, e **feriado não é erro** —
o job precisa encerrar como "sem dado" em vez de `failed`.

## O que já está testado

`@bolsiq/domain` tem 100% de cobertura nas conversões onde o dado sai errado em
silêncio:

| Função               | O que protege                                                               |
| -------------------- | --------------------------------------------------------------------------- |
| `shiftDecimal`       | aritmética decimal exata; `1234567890123 / 100` em double já perde precisão |
| `parseCotahistPrice` | centavos e fator de cotação, nesta ordem                                    |
| `isLotePadraoAVista` | sem o filtro `CODBDI`/`TPMERC` entram opções, termo e fracionário           |
| `pickLatestVersion`  | `ORDEM_EXERC = 'ÚLTIMO'` e maior `VERSAO`                                   |
| `applyCvmScale`      | `ESCALA_MOEDA`; ignorá-la erra a demonstração por mil                       |
| `parseBcbDate`       | `dd/MM/yyyy`; `new Date()` embaralha os doze primeiros dias de cada mês     |
| `janelasDeConsulta`  | o SGS devolve 406 em janela longa                                           |

`applyCvmScale` falha alto em escala desconhecida em vez de assumir `UNIDADE`:
assumir erraria por mil, e o número continuaria plausível.

## Rodando

```bash
make up                # Postgres + NATS
make db-migrate        # aplica as migrations
make test              # unitários com piso de cobertura
```

Ou o compose do CI, que é o caminho mais próximo de produção:

```bash
docker build -f infra/docker/market-data.Dockerfile -t bolsiq-market-data:local .
```

```bash
IMAGE_TAG=local docker compose -f infra/docker/compose.ci.yml up -d --wait
```

```bash
bash infra/docker/smoke.sh http://localhost:8000
```

Isso sobe o Postgres, aplica as migrations como passo único e sobe `api` e
`worker` da mesma imagem.

## Endpoints

| Método | Rota               | Chave | Observação                                 |
| ------ | ------------------ | ----- | ------------------------------------------ |
| GET    | `/v1/health`       | não   | único endpoint servido por todos os papéis |
| GET    | `/v1/openapi.json` | não   | gerado dos schemas Zod                     |

As rotas de dados entram conforme os adapters nascem. Toda rota nova passa por
`routes/specs.ts`, que é a fonte única do app e do OpenAPI — é isso que impede
os dois de divergirem, e o que o check `contract` do CI compara com `oasdiff`.

Contrato para o cliente: [guia-do-cliente.md](../api/guia-do-cliente.md).

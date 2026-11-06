# market-data

Serviço de dados de mercado. É o produto principal: a API pública versionada
`/v1` que será vendida, concorrendo com a brapi.

Nenhum outro serviço acessa fonte externa de dados. Quem precisa de dado de
mercado chama este serviço.

## Estado atual

| Parte                                              | Estado                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Monorepo, TypeScript estrito, Turborepo            | pronto                                                                                                                     |
| Schema e migrations, com 4 hypertables             | pronto, aplicado em Postgres 17 + TimescaleDB                                                                              |
| Fastify com `ROLE`, health e OpenAPI gerado do Zod | pronto, com Swagger UI em `/docs`                                                                                          |
| pg-boss com filas e agenda                         | pronto, manipuladores ligados a cada job                                                                                   |
| Imagem Docker e compose                            | pronto, smoke passando                                                                                                     |
| Adapters brapi, B3 COTAHIST, CVM e BCB             | pronto; brapi e SGS em read-through, COTAHIST e CVM em lote (ADR 0013)                                                     |
| Endpoints de dados `/v1`                           | pronto: assets, quotes, history, dividends, fundamentals, funds, fiis, macro                                               |
| Endpoints `/admin/jobs`                            | pronto, com `ADMIN_TOKEN`                                                                                                  |
| Produtor de eventos via outbox                     | pronto: quote.updated, daily.closed, dividend.announced, statement.published, fii.report.published, asset.listed           |
| Carga histórica                                    | pronto: `make backfill FROM=2024`, cerca de 8 minutos                                                                      |
| Fundos (`cvm-fundos`)                              | pronto: cadastro das classes e informe diário; `/v1/funds`                                                                 |
| FIIs (`cvm-fii-mensal`)                            | pronto: informe mensal da CVM, ligado ao ticker pelo ISIN; `/v1/fiis` ([ADR 0023](../adr/0023-fii-pelo-informe-mensal.md)) |
| Autenticação, planos e medição                     | **não implementados** — ver [ADR 0007](../adr/0007-gateway-e-planos.md)                                                    |

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
    config.ts            ROLE e ambiente, validados por Zod
    app.ts               aplicação Fastify (não abre porta: testável por inject)
    server.ts            ponto de entrada; decide o que sobe conforme ROLE
    worker.ts            pg-boss: filas, agenda e manipuladores
    backfill.ts          carga histórica (make backfill)
    fontes/              um adapter por fonte: brapi, b3-cotahist, cvm, bcb
    dados/ingestao.ts    gravação em lote, com outbox na mesma transação
    dados/servico.ts     leitura do /v1, com read-through e coalescência
    dados/carga.ts       fetch_log: idempotência por hash do arquivo
    jobs/registry.ts     definição dos jobs, cron, retry e expiração
    jobs/handlers.ts     o que cada job faz (worker e backfill usam o mesmo)
    jobs/admin.ts        /admin/jobs sobre as tabelas do pg-boss
    routes/specs.ts      rotas em Zod — fonte única do app e do OpenAPI
    routes/registrar.ts  registra as rotas a partir das specs
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
| `live_quotes`                          | `ticker`                                                                    | não                |
| `dividends`                            | `(ticker, ex_date, kind)`                                                   | não                |
| `share_counts`                         | `(cnpj, reference_date)`                                                    | não                |
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

| Job                   | Agenda          |
| --------------------- | --------------- |
| `b3-cotahist-diario`  | `30 20 * * 1-5` |
| `b3-cotahist-lacunas` | `0 7 * * 1-5`   |
| `cvm-fundos`          | `0 6 * * *`     |
| `cvm-fii-mensal`      | `30 6 * * *`    |
| `bcb-sgs`             | `0 6 * * *`     |
| `cvm-cadastro`        | `0 5 * * 1`     |
| `cvm-dfp`             | `30 5 * * 1`    |
| `cvm-itr`             | `0 6 * * 1`     |
| `b3-cotahist-anual`   | sob demanda     |
| `ajuste-proventos`    | sob demanda     |

Cada job tem manipulador em `jobs/handlers.ts`. O `backfill.ts` chama os
mesmos manipuladores, em ordem: COTAHIST anual, cadastro, DFP e ITR, informe
mensal de FII (desde o ano anterior a `FROM`), SGS e fundos.

| Job                   | O que faz                                                                                                    | Eventos                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `b3-cotahist-diario`  | pregão do dia; 404 da B3 encerra como `sem_pregao` e fica registrado, não falha                              | `quote.updated` por papel, `daily.closed`  |
| `b3-cotahist-lacunas` | dia útil dos últimos 10 (`{"dias": 30}` amplia) sem preço: refaz o diário                                    | os mesmos do `b3-cotahist-diario`          |
| `b3-cotahist-anual`   | ano inteiro (`{"ano": 2024}`), sem evento de preço                                                           | `asset.listed` para papel novo             |
| `cvm-cadastro`        | cadastro + FCA: liga ticker a CNPJ, código CVM e setor                                                       | nenhum                                     |
| `cvm-dfp`, `cvm-itr`  | demonstrativos do ano corrente e do anterior; pula arquivo de hash igual                                     | `statement.published` por companhia e data |
| `bcb-sgs`             | CDI, Selic, IPCA e IGP-M desde o último ponto gravado                                                        | nenhum                                     |
| `cvm-fundos`          | cadastro das classes e informe diário do mês corrente e do anterior (`{"meses": 13}` amplia)                 | nenhum                                     |
| `cvm-fii-mensal`      | informe mensal de FII do ano corrente e do anterior (`{"ano": 2025}` escolhe); liga CNPJ ao ticker pelo ISIN | `fii.report.published` por FII com ticker  |
| `ajuste-proventos`    | sem efeito: o ajuste é calculado na leitura de `/v1/history`                                                 | —                                          |

### Feriado e arquivo atrasado

A B3 responde 404 nos dois casos e não publica o calendário de pregão em
formato consumível, então o job não tem como distingui-los na hora. A diferença
aparece no tempo: o arquivo atrasado existe na varredura seguinte, o feriado
nunca.

Por isso o 404 não falha o job, mas é registrado no `fetch_log` com
`status = 'sem-pregao'` e a contagem de tentativas. `b3-cotahist-lacunas` roda
às 7:00 e pede de novo todo dia útil dos últimos 10 que não tem preço em
`quotes_daily`, até o dia acumular 3 tentativas — aí é aceito como feriado e
sai da lista.

O horário das 20:30 do `b3-cotahist-diario` é estimativa: a B3 não divulga
quando publica o arquivo do dia. Às 19:30 ele ainda não estava no ar, e o 404
descartava o pregão de forma definitiva (#29). Quem garante o dia é a varredura
de lacunas, não o horário.

### Idempotência da carga

`fetch_log` guarda o hash de cada arquivo. Hash igual a uma carga `ok`: o
arquivo é pulado. Carga que caiu no meio (status `processando` ou `falhou`) é
refeita em **modo de recuperação**, que emite eventos para tudo o que está no
arquivo e não só para o que mudou: a tentativa anterior pode ter gravado o dado
e perdido o evento.

### Duas armadilhas do ITR

O ITR traz, para a mesma conta e data-base, a DRE do trimestre e a acumulada no
ano. A chave natural não inclui o início do período, então só uma fica: vale a
maior versão e, na mesma versão, o período mais curto (o trimestre). A regra
está no lote em memória e no `WHERE` do upsert, para o resultado não depender
de em qual lote cada linha caiu.

O DMPL fica de fora: tem uma coluna de valor por componente do patrimônio, o
que quebra a chave por conta, e nenhum indicador o usa.

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

Ambiente completo (Postgres, NATS, Mailpit, API, worker, alerts e analytics):

```bash
make dev-up
```

Carga histórica desde 2024 (COTAHIST, CVM e BCB), cerca de 8 minutos:

```bash
make backfill FROM=2024
```

Swagger em http://localhost:8000/docs. As rotas `/admin` pedem o token do
compose (`dev-admin-token-troque-em-producao`) no botão "Authorize".

Testes:

```bash
make test
```

```bash
make test-integration
```

### Variáveis

| Variável              | Padrão | Para quê                                                |
| --------------------- | ------ | ------------------------------------------------------- |
| `BRAPI_TOKEN`         | vazio  | sem token, a brapi só serve os tickers de demonstração  |
| `BRAPI_DELAY_MINUTES` | 15     | atraso informado em `meta.delay_minutes` da cotação     |
| `QUOTE_TTL_SECONDS`   | 60     | validade da cotação corrente no cache                   |
| `ADMIN_TOKEN`         | vazio  | token das rotas `/admin`; sem ele, `/admin` recusa tudo |

## Endpoints

| Método | Rota                        | Fonte                          | Observação                                            |
| ------ | --------------------------- | ------------------------------ | ----------------------------------------------------- |
| GET    | `/v1/health`                | —                              | anônimo; servido por todos os papéis                  |
| GET    | `/v1/openapi.json`, `/docs` | —                              | gerados dos schemas Zod                               |
| GET    | `/v1/assets?q=&type=`       | COTAHIST + cadastro CVM        | até 20; ticker exato primeiro, depois prefixo, nome   |
| GET    | `/v1/assets/{ticker}`       | COTAHIST + cadastro CVM        |                                                       |
| GET    | `/v1/quotes/{tickers}`      | brapi; reserva no COTAHIST     | até 20 tickers separados por vírgula                  |
| GET    | `/v1/history/{ticker}`      | COTAHIST; proventos da brapi   | `interval=1d\|1wk\|1mo`, padrão 1 ano, ajustado       |
| GET    | `/v1/dividends/{ticker}`    | brapi                          | dividendo, JCP, desdobramento, grupamento             |
| GET    | `/v1/fundamentals/{ticker}` | CVM DFP/ITR                    | `period=annual\|quarterly`; consolidado se houver     |
| GET    | `/v1/macro/{serie}`         | SGS; IBOV pela brapi ou BOVA11 | `cdi`, `selic`, `ipca`, `igpm`, `ibov`                |
| GET    | `/v1/funds?q=`              | CVM (registro de classes)      | por nome ou CNPJ, até 20                              |
| GET    | `/v1/funds/{cnpj}`          | CVM (registro de classes)      | CNPJ com ou sem pontuação                             |
| GET    | `/v1/funds/{cnpj}/history`  | CVM (informe diário)           | cota, patrimônio e cotistas por dia                   |
| GET    | `/v1/fiis/{ticker}/monthly` | CVM (informe mensal de FII)    | PL, VP da cota, cotistas e DY por competência; 2 anos |
| GET    | `/admin/jobs`               | pg-boss                        | `Authorization: Bearer $ADMIN_TOKEN`                  |
| POST   | `/admin/jobs/{name}`        | pg-boss                        | corpo opcional `{"data": {"ano": 2024}}`              |

Toda resposta de dados traz `meta`: `source`, `fetched_at`, `license`,
`stale` e `delay_minutes`. `stale` é verdadeiro quando a fonte falhou e o valor
é o último conhecido, ou quando o pregão esperado ainda não foi carregado.

Decisões que valem para todas:

- **Ajuste por proventos é calculado na leitura**, para trás: o último preço é
  o negociado, e cada provento multiplica os anteriores por `1 - D/P`. Não há
  coluna `adj_close` a manter em dia.
- **IBOV sem token da brapi vem do BOVA11.** O SGS parou de publicar o
  Ibovespa (série 7) em 2019. O ETF replica o índice e está no COTAHIST; a
  unidade da resposta diz que é aproximação.
- **Provento antigo não é anúncio.** `dividend.announced` só sai para data-ex
  dos últimos 7 dias em diante: a primeira leitura da PETR4 traz 400 proventos
  históricos, que disparariam alerta de dividendo pago há dez anos.

Toda rota nova passa por `routes/specs.ts`, que é a fonte única do app e do
OpenAPI — é isso que impede os dois de divergirem, e o que o check `contract`
do CI compara com `oasdiff`.

Contrato para o cliente: [guia-do-cliente.md](../api/guia-do-cliente.md).

## Fundos

O informe diário da CVM identifica pela **classe** (RCVM 175), em
`CNPJ_FUNDO_CLASSE`; é ela que vira item do comparador. Fundo não tem ticker: o
CNPJ é o identificador.

- **Cadastro**: `registro_fundo_classe.zip`, arquivo `registro_classe.csv`,
  cerca de 37 mil classes, em `market_data.funds`.
- **Cotas**: `inf_diario_fi_AAAAMM.zip`, cerca de 500 mil linhas por mês, em
  `fund_daily`. Só a linha da classe: a de subclasse repete CNPJ e data.
- **Profundidade**: o job diário carrega o mês corrente e o anterior; o
  backfill carrega 13 meses (`FUNDOS_MESES` amplia). Um mês leva cerca de 1,5
  minuto. Fundo fora da janela carregada não tem histórico no comparador.
- **Valor fora da escala**: o informe tem linhas com patrimônio acima de 10^14
  (erro de escala da fonte). `numeric(20,6)` não guarda, e a carga do mês caía
  inteira. A linha é descartada e contada no log (`descartadas`).

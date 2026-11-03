# Eventos

> **Documento gerado.** Não edite à mão: ele sai dos schemas Zod em
> `packages/contracts/src/events/`. Para atualizar, rode `make docs-events`.
> O CI confere com `--check` e reprova se o documento divergir do código.

Comunicação assíncrona entre serviços, por NATS JetStream com outbox no
Postgres. A decisão está no [ADR 0008](adr/0008-outbox-e-jetstream.md).

## Stream

| | |
| --- | --- |
| Nome | `MARKETDATA` |
| Subjects | `marketdata.>` |
| Retenção | `limits` (descarta `old` ao bater o teto) |
| Teto de mensagens | 5.000.000 |
| Teto de bytes | 8 GiB |
| Idade máxima | 30 dias |
| Janela de deduplicação | 2 h |
| Armazenamento | `file` |

## Nome dos eventos

`<domínio>.<entidade>.<ação>.v<N>`. A versão está **no nome**, não num campo:
quebrar o payload exige um nome novo, e os dois convivem enquanto houver
consumidor do antigo. É o mesmo princípio do `/v1` da API pública, aplicado ao
barramento.

## Garantias

| Camada | O que cobre |
| --- | --- |
| **Outbox** no Postgres, na mesma transação do dado | Entrega ao menos uma vez. Se o NATS está fora, o evento espera; nunca se perde nem aparece sem o dado |
| **Deduplicação do JetStream** por `Nats-Msg-Id` (id da linha do outbox) | Republicação dentro da janela não vira mensagem nova |
| **`processed_events`** no consumidor | O que passa da janela. A marca comita na mesma transação das escritas do handler |
| **Dead-letter** após N entregas | Payload inválido ou bug de handler não bloqueiam a fila atrás deles |

O `/v1/stream` do WebSocket é a exceção deliberada: assinatura core,
**at-most-once**, sem estado. Quem abriu o navegador quer o preço de agora, não
o histórico do stream — e a próxima cotação do mesmo ticker torna a anterior
irrelevante.


## Catálogo

| Evento | Produtor | Consumidores |
| --- | --- | --- |
| [`marketdata.quote.updated.v1`](#marketdataquoteupdatedv1) | `market-data` | `apps/web (WebSocket /v1/stream)`, `alerts` |
| [`marketdata.daily.closed.v1`](#marketdatadailyclosedv1) | `market-data` | `analytics`, `portfolio` |
| [`marketdata.dividend.announced.v1`](#marketdatadividendannouncedv1) | `market-data` | `market-data (ajuste-proventos)`, `portfolio`, `alerts` |
| [`marketdata.statement.published.v1`](#marketdatastatementpublishedv1) | `market-data` | `analytics` |
| [`marketdata.fii.report.published.v1`](#marketdatafiireportpublishedv1) | `market-data` | `analytics` |
| [`marketdata.asset.listed.v1`](#marketdataassetlistedv1) | `market-data` | `apps/web`, `analytics` |
| [`marketdata.asset.delisted.v1`](#marketdataassetdelistedv1) | `market-data` | `apps/web`, `analytics`, `portfolio` |
| [`analytics.indicators.updated.v1`](#analyticsindicatorsupdatedv1) | `analytics` | `alerts` |

## marketdata.quote.updated.v1

Cotação de um ativo foi atualizada. Emitido a cada preço novo gravado em quotes_daily.

- **Subject:** `marketdata.quote.updated.v1`
- **Produtor:** `market-data`
- **Consumidores:** `apps/web (WebSocket /v1/stream)`, `alerts`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `ticker` | string | sim |
| `price` | string decimal | sim |
| `change` | ? | sim |
| `ts` | string (ISO 8601) | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "marketdata.quote.updated.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "market-data",
  "payload": {
    "ticker": "PETR4",
    "price": "38.42",
    "change": "-0.58",
    "ts": "2026-10-31T21:05:00Z"
  }
}
```

## marketdata.daily.closed.v1

A carga diária do COTAHIST terminou. Marca o momento a partir do qual o dia está completo.

- **Subject:** `marketdata.daily.closed.v1`
- **Produtor:** `market-data`
- **Consumidores:** `analytics`, `portfolio`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `date` | string (YYYY-MM-DD) | sim |
| `assets_updated` | integer | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "marketdata.daily.closed.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "market-data",
  "payload": {
    "date": "2026-10-31",
    "assets_updated": 1842
  }
}
```

## marketdata.dividend.announced.v1

Provento anunciado. É o gatilho do recálculo de adj_close (job ajuste-proventos).

- **Subject:** `marketdata.dividend.announced.v1`
- **Produtor:** `market-data`
- **Consumidores:** `market-data (ajuste-proventos)`, `portfolio`, `alerts`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `ticker` | string | sim |
| `kind` | `dividendo` \| `jcp` \| `bonificacao` \| `desdobramento` \| `grupamento` | sim |
| `value_per_share` | string decimal | sim |
| `ratio` | string | sim |
| `ex_date` | string (YYYY-MM-DD) | sim |
| `payment_date` | ? | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "marketdata.dividend.announced.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "market-data",
  "payload": {
    "ticker": "PETR4",
    "kind": "dividendo",
    "value_per_share": "1.25",
    "ratio": null,
    "ex_date": "2026-11-10",
    "payment_date": "2026-11-25"
  }
}
```

## marketdata.statement.published.v1

Demonstração financeira nova ou reapresentada foi gravada. Reapresentação também emite.

- **Subject:** `marketdata.statement.published.v1`
- **Produtor:** `market-data`
- **Consumidores:** `analytics`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `cvm_code` | string | sim |
| `tickers` | array de string | sim |
| `period_end` | string (YYYY-MM-DD) | sim |
| `statement_kind` | `DFP` \| `ITR` | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "marketdata.statement.published.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "market-data",
  "payload": {
    "cvm_code": "9512",
    "tickers": [
      "PETR3",
      "PETR4"
    ],
    "period_end": "2026-09-30",
    "statement_kind": "ITR"
  }
}
```

## marketdata.fii.report.published.v1

Informe mensal de FII novo ou reapresentado foi gravado. Um evento por fundo, com a competência mais recente que mudou.

- **Subject:** `marketdata.fii.report.published.v1`
- **Produtor:** `market-data`
- **Consumidores:** `analytics`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `cnpj` | string | sim |
| `tickers` | array de string | sim |
| `reference_date` | string (YYYY-MM-DD) | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "marketdata.fii.report.published.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "market-data",
  "payload": {
    "cnpj": "11728688000147",
    "tickers": [
      "HGLG11"
    ],
    "reference_date": "2026-09-01"
  }
}
```

## marketdata.asset.listed.v1

Ativo novo entrou no universo.

- **Subject:** `marketdata.asset.listed.v1`
- **Produtor:** `market-data`
- **Consumidores:** `apps/web`, `analytics`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `ticker` | string | sim |
| `isin` | string | sim |
| `kind` | `stock` \| `fii` \| `bdr` \| `etf` \| `fund` | sim |
| `name` | string | sim |
| `listed_at` | string (YYYY-MM-DD) | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "marketdata.asset.listed.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "market-data",
  "payload": {
    "ticker": "NEWX3",
    "isin": "BRNEWXACNOR1",
    "kind": "stock",
    "name": "Nova Empresa",
    "listed_at": "2026-10-01"
  }
}
```

## marketdata.asset.delisted.v1

Ativo saiu do universo. Dado histórico permanece.

- **Subject:** `marketdata.asset.delisted.v1`
- **Produtor:** `market-data`
- **Consumidores:** `apps/web`, `analytics`, `portfolio`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `ticker` | string | sim |
| `kind` | `stock` \| `fii` \| `bdr` \| `etf` \| `fund` | sim |
| `delisted_at` | string (YYYY-MM-DD) | sim |
| `reason` | string | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "marketdata.asset.delisted.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "market-data",
  "payload": {
    "ticker": "OLDX3",
    "kind": "stock",
    "delisted_at": "2026-09-15",
    "reason": "fechamento de capital"
  }
}
```

## analytics.indicators.updated.v1

Indicadores de um ativo foram recalculados. Alimenta os alertas fundamentalistas sem que o alerts leia o schema analytics.

- **Subject:** `analytics.indicators.updated.v1`
- **Produtor:** `analytics`
- **Consumidores:** `alerts`

### Payload

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `ticker` | string | sim |
| `reference_date` | string (YYYY-MM-DD) | sim |
| `preco_graham` | string decimal | sim |
| `preco_bazin` | ? | sim |
| `dy_12m` | number | sim |
| `pl` | number | sim |
| `pvp` | number | sim |

### Exemplo

```json
{
  "id": "0193a1f0-4f7c-7000-8000-000000000001",
  "name": "analytics.indicators.updated.v1",
  "occurred_at": "2026-10-31T21:05:00.000Z",
  "producer": "analytics",
  "payload": {
    "ticker": "PETR4",
    "reference_date": "2026-09-30",
    "preco_graham": "42.92",
    "preco_bazin": "88.33",
    "dy_12m": 0.0989,
    "pl": 13.38,
    "pvp": 1.35
  }
}
```

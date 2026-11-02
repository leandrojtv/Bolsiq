# ADR 0018 - Processo dedicado para o recálculo do analytics

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto

O ADR 0009 fez do analytics um módulo (`packages/analytics`) que lê dado de
mercado pela API `/v1` ou por evento, nunca pelo schema `market_data`. O
recálculo por evento ficou pendente porque os eventos não tinham produtor.

Agora têm. Alguém precisa consumir `statement.published`, `daily.closed` e
`asset.listed`, chamar o `/v1` e gravar `analytics.indicators`. O `apps/web`,
onde o módulo viveria, não existe, e mesmo quando existir é servidor de
requisição, não consumidor de longa duração (mesmo argumento do ADR 0012).

## Decisão

**Processo `analytics-worker` com imagem dedicada**, de
`services/analytics-worker` sobre `packages/analytics`, no molde do
`alerts-worker`:

- consome o stream `MARKETDATA` com o consumidor durável `analytics-marketdata`,
  idempotência e dead-letter no schema `analytics`;
- o handler do evento só **enfileira** em `analytics.recalc_queue`, dentro da
  transação da marca de idempotência. Chamada HTTP dentro da transação
  seguraria a conexão por segundos;
- um laço drena a fila com `FOR UPDATE SKIP LOCKED` e concorrência configurável
  (`RECALC_CONCURRENCY`). Um índice único parcial garante um pendente por
  ticker: 700 `statement.published` e um `daily.closed` no mesmo minuto viram
  um recálculo por papel;
- lê tudo pelo `/v1` (`MARKET_DATA_URL`), validando a resposta com o mesmo
  schema Zod que gera o OpenAPI.

O screener (`executarScreener`) fica no pacote, para o BFF do `apps/web`
chamar quando existir.

## Consequências

### Positivas

- A fronteira do ADR 0009 se mantém: nenhum join com `market_data`.
- Falha isolada: recálculo lento não afeta a API pública nem os alertas.
- O analytics vira serviço sem reescrita: já fala só HTTP e evento.

### Negativas

- O recálculo do universo depois de cada `daily.closed` faz cinco chamadas
  HTTP por ticker (cerca de 2.200 papéis). Aceitável no volume atual; com mais
  carga, um endpoint em lote no `/v1` resolve.
- ~~`analytics.indicators.updated` ainda não é emitido~~: resolvido com o
  outbox no schema `analytics` (o publisher de `@bolsiq/messaging` aceita a
  tabela de qualquer schema).

## Pendências

1. ~~Outbox no schema `analytics` e emissão de `analytics.indicators.updated`~~: feito.
2. Endpoint em lote no `/v1` para o recálculo do universo.

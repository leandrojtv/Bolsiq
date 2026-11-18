# ADR 0023 - Indicadores de FII pelo informe mensal da CVM

- **Status:** aceito
- **Data:** 2026-11-03
- **Decisores:** @leandrojtv

## Contexto

No screener, todo FII aparecia com P/VP, patrimônio líquido e cotistas nulos e
DY 12m zero. O analytics calcula DY pelos proventos de `/v1/dividends`, que vêm
da brapi, e sem `BRAPI_TOKEN` a brapi só responde os tickers de demonstração.
P/VP de FII precisa do valor patrimonial da cota, que nenhuma fonte ingerida
trazia: o DFP/ITR é de companhia aberta, e o informe diário de fundos não cobre
FII de forma confiável nem tem ligação com o ticker.

A CVM publica o Informe Mensal de FII (Anexo 39-I da ICVM 472), em dados
abertos sob ODbL: um zip por ano com patrimônio, cotas, VP da cota, cotistas e
DY do mês declarados pelo administrador, além do ISIN da cota.

## Decisão

1. **Fonte:** o informe mensal entra no market-data por carga em lote (ADR
   0013), job `cvm-fii-mensal` diário, ano corrente e anterior, hash no
   `fetch_log`. Tabela `market_data.fii_monthly`, chave `(cnpj,
reference_date)`, maior `version` vence.
2. **Ligação CNPJ → ticker pelo ISIN.** O FCA não cobre fundo; o ISIN do
   informe é o mesmo do COTAHIST. A carga grava o CNPJ em `assets.cnpj` dos
   papéis `fii` com aquele ISIN, a cada execução.
3. **Contrato:** `GET /v1/fiis/{ticker}/monthly` devolve as competências como a
   CVM publica (percentuais em fração, string decimal). Evento novo
   `marketdata.fii.report.published.v1`, um por FII com ticker, com a
   competência mais recente que mudou.
4. **DY 12m de FII:** brapi tem precedência quando há proventos (data-ex e
   valor pagos). Sem eles, o analytics estima o rendimento por cota de cada mês
   como `DY_mes × VP_cota` e soma os 12 meses que terminam na competência mais
   recente, dividindo pelo preço. DY do mês negativo conta zero.
5. **P/VP de FII** é preço sobre o VP da cota da competência mais recente.

## Alternativas consideradas

- **brapi com token.** Resolve o DY, não o P/VP, e põe o indicador central de
  FII atrás de um plano pago de terceiro, sem o qual o produto não funciona.
- **Ingerir `Rendimentos_Distribuir`** (ativo_passivo) como rendimento do mês.
  É saldo de passivo, não o valor distribuído no mês: acumula e zera conforme
  o calendário de pagamento.
- **Ligar pelo nome do fundo.** Nomes mudam (CSHG Log virou Pátria Log) e não
  são únicos; o ISIN é.

## Consequências

### Positivas

- FII tem P/VP, DY 12m, patrimônio e cotistas sem token, de fonte aberta e
  redistribuível com atribuição.
- O screener ordena e filtra FII por esses indicadores; preset `fii_desconto`.

### Negativas

- O DY do informe é declarado pelo administrador, sobre o VP, e tem erro de
  preenchimento (cerca de 10% dos meses de 2026 vêm negativos). O DY 12m é
  estimativa, não soma de proventos pagos; a doc do analytics diz isso.
- Defasagem: a competência sai até 15 dias depois do fim do mês, então o VP
  usado no P/VP tem de um a dois meses.
- Vacância continua sem fonte: está no informe trimestral, por imóvel.

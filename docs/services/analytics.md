# analytics

Indicadores, comparador e screener. Modulo isolado em `packages/analytics`, com
schema proprio `analytics` no banco.

**Nao acessa o schema `market_data`.** Le dado de mercado pela API `/v1` ou por
evento, e mantem copia local do que precisa para consultar rapido. O porque esta
no [ADR 0009](../adr/0009-analytics-como-modulo.md).

## Estado atual

| Parte                                     | Estado                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| Formulas dos indicadores                  | pronto, conferido contra o DFP 2024 da CVM           |
| Schema `analytics` e migrations           | pronto, 6 tabelas, 2 hypertables                     |
| Filtro do screener em Zod, com presets    | pronto                                               |
| Execucao do screener (`executarScreener`) | pronto, testado contra Postgres real                 |
| Recalculo por evento                      | pronto, no processo `analytics-worker` (ADR 0018)    |
| `analytics.indicators.updated`            | pronto: outbox no schema `analytics`, so quando muda |
| Telas `/comparar` e `/screener`           | prontas no `apps/web`                                |
| `POST /api/screener`                      | pronto, BFF do `apps/web`, abaixo de 300 ms          |

## Recalculo

O `analytics-worker` consome o stream `MARKETDATA` e enfileira em
`analytics.recalc_queue`:

| Evento                 | Recalcula                          |
| ---------------------- | ---------------------------------- |
| `asset.listed`         | o ticker novo                      |
| `statement.published`  | os tickers da companhia            |
| `daily.closed`         | todo o universo listado no espelho |
| `dividend.announced`   | o ticker                           |
| `fii.report.published` | os tickers do FII                  |
| `asset.delisted`       | nada; marca o espelho como fora    |

O handler so enfileira, dentro da transacao da idempotencia. Um laco drena a
fila com `FOR UPDATE SKIP LOCKED` e chama o `/v1` para cada ticker:
`assets`, `history` (bruto e ajustado, 1 ano), `fundamentals` (anual) e
`dividends` (6 anos) e, para FII, `fiis/{ticker}/monthly` (2 anos). CDI e
IBOV sao lidos uma vez por hora para a rodada.

Acao com DFP calcula tudo, com data-base igual a do demonstrativo. FII, ETF e
BDR, sem demonstrativo, calculam o que so depende de preco e provento:
desempenho, dividend yield e Bazin, com data-base no ultimo pregao. FII com
informe mensal ligado ganha tambem P/VP, patrimonio liquido e cotistas (ver
[FIIs e fundos](#fiis-e-fundos)).

Conta ausente na fonte vira indicador nulo, nao zero: banco sem resultado bruto
fica sem margem bruta. Razao acima de 10^11 tambem vira nula, em vez de
estourar o `numeric`.

### Escala do numero de acoes

O `composicao_capital` da CVM mistura unidades e milhares no mesmo arquivo, sem
coluna que diga qual. No DFP 2025, 261 de 668 companhias informam em milhares
(Cyrela: 366.311; Vale: 4.268.779). O `market-data` devolve o numero como a
fonte publica; o recalculo escolhe a escala em que o P/VP fica entre 0,05 e 40. A faixa e mais estreita que o fator mil, entao no maximo uma escala passa.
Nenhuma passando (patrimonio negativo), os indicadores por acao ficam nulos.

Sem a correcao, essas 261 empresas apareciam com P/L perto de zero no topo de
qualquer filtro de valor.

## Entradas

| Entrada                   | Origem                           | Como chega                                                                                               |
| ------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Demonstracoes financeiras | CVM DFP e ITR, via `market-data` | evento `marketdata.statement.published.v1` dispara o recalculo; os numeros vem de `GET /v1/fundamentals` |
| Preco e serie de retornos | B3 COTAHIST, via `market-data`   | evento `marketdata.daily.closed.v1`; serie de `GET /v1/quotes`                                           |
| Proventos                 | `market-data`                    | evento `marketdata.dividend.announced.v1`                                                                |
| Informe mensal de FII     | CVM, via `market-data`           | evento `marketdata.fii.report.published.v1`; os numeros vem de `GET /v1/fiis/{ticker}/monthly`           |
| CDI e IPCA                | BCB SGS, via `market-data`       | `GET /v1/macro`                                                                                          |
| Universo e setor          | `market-data`                    | eventos `asset.listed` e `delisted`, espelhados em `analytics.assets_mirror`                             |

Todo valor monetario entra e sai como string decimal, nunca `number` (regra 5
do CLAUDE.md). As razoes adimensionais saem como `number`, porque P/L nao e
dinheiro.

## Formulas

Notacao: $L$ lucro liquido, $PL$ patrimonio liquido, $R$ receita, $A$ ativo
total, $P$ preco, $N$ acoes em circulacao.

### Derivados

$$\text{EBITDA} = \text{EBIT} + \text{D\&A} \qquad \text{DL} = \text{Divida bruta} - \text{Caixa}$$

$$\text{VM} = P \cdot N \qquad \text{EV} = \text{VM} + \text{DL} \qquad \text{LPA} = \frac{L}{N} \qquad \text{VPA} = \frac{PL}{N}$$

O EV soma a divida liquida porque quem compra a empresa assume a divida e fica
com o caixa. Caixa liquido (DL negativa) reduz o EV, e e o caso da WEG nos
testes.

### Valuation

$$\frac{P}{L} = \frac{P}{\text{LPA}} \qquad \frac{P}{VP} = \frac{P}{\text{VPA}} \qquad \frac{P}{R} = \frac{\text{VM}}{R}$$

$$\frac{EV}{\text{EBITDA}} \qquad \frac{EV}{\text{EBIT}} \qquad \text{DY}_{12m} = \frac{\text{proventos 12m por acao}}{P} \qquad \text{DY}_{5a} = \frac{\frac{1}{5}\sum_{i=1}^{5} \text{prov}_i}{P}$$

### Rentabilidade

$$\text{ROE} = \frac{L}{PL} \qquad \text{ROA} = \frac{L}{A} \qquad \text{ROIC} = \frac{\text{EBIT} \cdot (1 - t)}{PL + \text{DL}}$$

$$\text{Margem bruta} = \frac{\text{Resultado bruto}}{R} \qquad \text{Margem EBITDA} = \frac{\text{EBITDA}}{R} \qquad \text{Margem liquida} = \frac{L}{R}$$

$t = 0{,}34$, soma nominal de IRPJ (25%) e CSLL (9%). A aliquota efetiva varia
por empresa; a nominal mantem o indicador comparavel entre empresas, que e para
o que ele serve num screener. O denominador do ROIC e capital investido
($PL + DL$), nao ativo total: mede retorno sobre o capital que a operacao usa.

### Endividamento

$$\frac{\text{DL}}{\text{EBITDA}} \qquad \frac{\text{DL}}{PL} \qquad \text{Liquidez corrente} = \frac{\text{Ativo circulante}}{\text{Passivo circulante}}$$

### Crescimento

$$\text{CAGR} = \left(\frac{V_{\text{final}}}{V_{\text{inicial}}}\right)^{1/n} - 1$$

Indefinido quando $V_{\text{inicial}} \le 0$ ou $V_{\text{final}} \le 0$. Nao
existe taxa composta a partir de base negativa, e empresa que saiu de prejuizo
para lucro nao tem CAGR de lucro. Inventar um numero ali e o jeito mais facil
de um screener mentir.

### Preco justo

$$\text{Graham} = \sqrt{22{,}5 \cdot \text{LPA} \cdot \text{VPA}} \qquad \text{Bazin} = \frac{\frac{1}{5}\sum \text{prov}_i}{y}$$

$$\text{Margem de seguranca} = \frac{\text{preco justo} - P}{\text{preco justo}}$$

A constante 22,5 e $15 \times 1{,}5$: o P/L e o P/VP maximos que Graham aceitava.
Indefinido quando LPA ou VPA nao sao positivos, porque a raiz de produto
negativo nao existe nos reais e o resultado nao teria significado.

Bazin usa $y = 0{,}06$ por padrao, configuravel. Usa a **media** de 5 anos, nao
o ultimo ano: o metodo existe para achar dividendo consistente, e um ano
excepcional elevaria justamente o teto que deveria ser conservador.

### Desempenho

$$R_{\text{acum}} = \prod_{i=1}^{n}(1 + r_i) - 1 \qquad \sigma_{\text{anual}} = \sqrt{\frac{\sum (r_i - \bar{r})^2}{n-1}} \cdot \sqrt{252}$$

$$\text{DD}_{\max} = \min_t \left( \frac{V_t}{\max_{s \le t} V_s} - 1 \right) \qquad \text{Sharpe} = \frac{\overline{(r_i - \text{cdi}_i)} \cdot 252}{\sigma_{\text{anual}}(r - \text{cdi})} \qquad \beta = \frac{\text{Cov}(r, r_{\text{ibov}})}{\text{Var}(r_{\text{ibov}})}$$

Tres escolhas que mudam o numero:

- **Retorno composto, nao somado.** Somar retornos diarios erra tanto mais
  quanto maior a janela e a volatilidade.
- **Desvio amostral ($n-1$).** Serie de retorno e sempre amostra.
- **Excesso contra o CDI do mesmo dia**, nao contra uma media do periodo. A
  Selic muda, e a media distorce o Sharpe justamente em janela de mudanca de
  juros, que e quando ele importa.

### FIIs e fundos

FIIs usam o informe mensal da CVM (`GET /v1/fiis/{ticker}/monthly`), com a
competencia mais recente:

| Coluna               | Formula                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `vpa`                | `nav_per_share` (VP da cota)                                        |
| `pvp`                | $P / VP_{cota}$                                                     |
| `patrimonio_liquido` | `equity`                                                            |
| `cotistas`           | `holders`                                                           |
| `dy_12m`             | brapi quando ela tem proventos do FII; senao, pelo informe (abaixo) |

O DY do informe e o que o administrador declara, sobre o valor patrimonial.
O rendimento por cota do mes e entao $DY_{mes} \times VP_{cota}$, e

$$\text{DY}_{12m} = \frac{\sum_{m} \max(DY_m, 0) \cdot VP_m}{P}$$

somando as competencias dos 12 meses que terminam na mais recente. Dois cortes
contra erro da fonte, medidos no backfill de 2025-2026:

- Mes com DY negativo (erro de preenchimento) ou acima de 5% (liquidacao ou
  amortizacao declarada como rendimento: RDLI11 com 36% em dez/2025) conta
  zero. Sao 123 de 15.284 competencias acima de 5%.
- P/VP fora de 0,2 a 5 indica VP e preco em escalas diferentes (grupamento que
  um dos lados nao refletiu: CARE11 com VP 34,35 e preco 2,94). Nesse caso P/VP
  e DY pelo informe ficam nulos; patrimonio e cotistas continuam.
  Sem `BRAPI_TOKEN`, que e o caso padrao, todo FII usa esse caminho; com token,
  a brapi tem precedencia por ter data-ex e valor pagos, nao estimados.
  `fonte_demonstrativo` fica `cvm-fii-mensal:<competencia>:v<versao>`.

Vacancia continua nula: o informe mensal nao traz ocupacao (esta no
trimestral, ainda nao ingerido).

Fundos usam rentabilidade contra CDI, volatilidade, patrimonio liquido e
cotistas, do informe diario da CVM.

## Conferencia contra a CVM

`src/cvm.fixtures.ts` traz os demonstrativos consolidados reais de Petrobras,
Vale e WEG do DFP 2024, exercicio 2024-12-31, com as tres regras da CVM
aplicadas (`ORDEM_EXERC = ULTIMO`, maior `VERSAO`, `ESCALA_MOEDA`).

Os valores esperados em `src/cvm.test.ts` foram calculados **fora** desta
implementacao, em Python, a partir dos mesmos numeros. Nao sao a saida do codigo
congelada: se os dois caminhos independentes concordam, a formula esta certa.

|                | Petrobras | Vale     | WEG         |
| -------------- | --------- | -------- | ----------- |
| Receita        | 490,8 bi  | 206,0 bi | 38,0 bi     |
| EBITDA         | 204,2 bi  | 72,0 bi  | 8,5 bi      |
| Divida liquida | 353,2 bi  | 65,3 bi  | **-3,8 bi** |
| ROE            | 10,07%    | 14,24%   | 27,32%      |
| Margem liquida | 7,54%     | 14,77%   | 16,63%      |
| DL/EBITDA      | 1,73      | 0,91     | **-0,44**   |

A WEG entra de proposito: caixa liquido produz divida liquida e DL/EBITDA
negativos, e e o caso em que um sinal trocado passaria despercebido.

## Limitacoes

1. **Numero de acoes.** O `composicao_capital` da CVM mistura escalas: a Vale
   aparece com 4.539.008 acoes (em milhares) enquanto Petrobras e WEG aparecem
   em unidades. Por isso a Vale nao tem indicador por acao nos testes. Ate
   haver fonte confiavel, P/L, P/VP e Graham dependem de um numero de acoes que
   precisa ser validado por ativo.
2. **Aliquota do ROIC** e nominal, nao efetiva. Empresa com incentivo fiscal
   aparece com ROIC subestimado.
3. **Indicador indefinido nao e zero.** Toda coluna e nula por escolha, e o
   screener exclui nulos da ordenacao por padrao -- exceto FII, ETF e BDR
   quando o indicador e de balanco (ver Screener).
4. **Sem ajuste por proventos** no retorno enquanto o `adj_close` do
   `market-data` nao existir: o desempenho fica subestimado para pagador de
   dividendo.
5. **Beta e Sharpe dependem de janela.** O valor muda com o periodo escolhido;
   nao ha janela canonica, e a UI tem de mostrar qual usou.
6. **Demonstrativo reapresentado muda indicador passado.** `indicators` guarda
   historico por `reference_date`, entao o recalculo sobrescreve a linha, nao
   acrescenta. Quem precisar auditar o valor anterior tem o `fonte_demonstrativo`.

## Schema

| Tabela          | Chave                      | Hypertable        |
| --------------- | -------------------------- | ----------------- |
| `indicators`    | `(ticker, reference_date)` | sim, chunk anual  |
| `daily_returns` | `(ticker, date)`           | sim, chunk mensal |
| `assets_mirror` | `ticker`                   | nao               |
| `recalc_queue`  | `id`                       | nao               |

`assets_mirror` e copia, nao fonte: o dono do universo e o `market-data`.
Existe para o screener filtrar por setor e tipo sem uma chamada de API por
linha, o que tornaria impossivel a meta de 300 ms.

## Screener

Filtro validado por Zod em `src/screener.ts`, com faixas por indicador, setor,
tipo e liquidez minima. Presets: `graham`, `bazin`, `magic_formula`,
`dividendos_consistentes` -- filtros nomeados com os numeros publicados por cada
autor, nao recomendacao -- e `fii_desconto` (FII com P/VP abaixo de 1 e DY 12m
acima de 8%), o corte usual do mercado de FII, sem autor.

`patrimonio_liquido` e `cotistas` sao filtraveis. Com so FII no filtro, a tela
abre com as colunas P/VP, DY 12m, patrimonio, cotistas e liquidez, em vez de
P/L, ROE e margem.

**Ordenacao por indicador de balanco** (`SO_DE_ACOES`: P/L, P/VP, ROE,
margens, endividamento, CAGR, Graham): sem "incluir indefinidos", descarta so a
acao sem o valor (prejuizo nao tem P/L). FII, ETF e BDR, que nunca terao esses
indicadores, entram depois das acoes, por liquidez. Antes, a ordenacao padrao
(P/L) escondia todo FII. P/VP sai do conjunto quando houver valor patrimonial de
FII na base.

Indices parciais em `pl`, `pvp`, `roe`, `dy_medio_5a`, `ev_ebit` e
`liquidez_diaria` cobrem os filtros mais usados. A meta de 300 ms para o
universo inteiro **ainda nao foi medida**: depende de haver universo carregado.

## Eventos que o analytics publica

`analytics.indicators.updated.v1` sai do outbox do schema `analytics`
(`analytics.outbox`), gravado na mesma transacao do upsert do indicador, e e
publicado pelo mesmo publisher do market-data (`@bolsiq/messaging`), lendo a
tabela do schema do analytics. So sai quando um dos campos do evento (precos
justos, DY, P/L, P/VP) mudou: o recalculo diario de 2.200 papeis nao vira 2.200
eventos iguais. O alerts consome para os alertas fundamentalistas.

## Comparador

`src/comparador.ts`, sem banco:

- `SENTIDO`: qual valor e o melhor em cada indicador. `maior`, `menor` ou
  `menor_positivo` (multiplos de preco: P/L negativo e prejuizo, nao
  pechincha). Beta nao tem melhor. O destaque "melhor da linha" do comparador
  usa `melhoresDaLinha`, entao a regra e a mesma para a tela e para quem chamar.
- `base100`, `nivelDeTaxa` (CDI e IPCA acumulados em decimal) e
  `estatisticas` (retorno, volatilidade so em serie diaria, drawdown).
- Identificadores da URL: ticker, CNPJ de fundo (14 digitos, aceito com
  pontuacao) e indice (`IBOV`, `CDI`, `IPCA`), ate 6.

`@bolsiq/analytics/puro` exporta so o que nao usa banco nem NATS, para o
navegador. O indice do pacote tambem exporta o worker.

## Preco gravado com o indicador

`analytics.indicators.preco` e o fechamento usado no calculo. O screener mostra
o preco sem consultar a cotacao de cada linha.

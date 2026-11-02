# analytics

Indicadores, comparador e screener. Modulo isolado em `packages/analytics`, com
schema proprio `analytics` no banco.

**Nao acessa o schema `market_data`.** Le dado de mercado pela API `/v1` ou por
evento, e mantem copia local do que precisa para consultar rapido. O porque esta
no [ADR 0009](../adr/0009-analytics-como-modulo.md).

## Estado atual

| Parte                                     | Estado                                              |
| ----------------------------------------- | --------------------------------------------------- |
| Formulas dos indicadores                  | pronto, conferido contra o DFP 2024 da CVM          |
| Schema `analytics` e migrations           | pronto, 6 tabelas, 2 hypertables                    |
| Filtro do screener em Zod, com presets    | pronto                                              |
| Execucao do screener (`executarScreener`) | pronto, testado contra Postgres real                |
| Recalculo por evento                      | pronto, no processo `analytics-worker` (ADR 0018)   |
| `analytics.indicators.updated`            | **nao emitido**: o analytics nao tem outbox proprio |
| Telas `/comparar` e `/screener`           | **nao implementadas**, dependem de `apps/web`       |
| `POST /api/screener`                      | **nao implementado**, e BFF do `apps/web`           |

## Recalculo

O `analytics-worker` consome o stream `MARKETDATA` e enfileira em
`analytics.recalc_queue`:

| Evento                | Recalcula                          |
| --------------------- | ---------------------------------- |
| `asset.listed`        | o ticker novo                      |
| `statement.published` | os tickers da companhia            |
| `daily.closed`        | todo o universo listado no espelho |
| `dividend.announced`  | o ticker                           |
| `asset.delisted`      | nada; marca o espelho como fora    |

O handler so enfileira, dentro da transacao da idempotencia. Um laco drena a
fila com `FOR UPDATE SKIP LOCKED` e chama o `/v1` para cada ticker:
`assets`, `history` (bruto e ajustado, 1 ano), `fundamentals` (anual) e
`dividends` (6 anos). CDI e IBOV sao lidos uma vez por hora para a rodada.

Acao com DFP calcula tudo, com data-base igual a do demonstrativo. FII, ETF e
BDR, sem demonstrativo, calculam o que so depende de preco e provento:
desempenho, dividend yield e Bazin, com data-base no ultimo pregao.

Conta ausente na fonte vira indicador nulo, nao zero: banco sem resultado bruto
fica sem margem bruta. Razao acima de 10^11 (dado quebrado na fonte, como o
numero de acoes da Vale em milhares) tambem vira nula, em vez de estourar o
`numeric`.

## Entradas

| Entrada                   | Origem                           | Como chega                                                                                               |
| ------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Demonstracoes financeiras | CVM DFP e ITR, via `market-data` | evento `marketdata.statement.published.v1` dispara o recalculo; os numeros vem de `GET /v1/fundamentals` |
| Preco e serie de retornos | B3 COTAHIST, via `market-data`   | evento `marketdata.daily.closed.v1`; serie de `GET /v1/quotes`                                           |
| Proventos                 | `market-data`                    | evento `marketdata.dividend.announced.v1`                                                                |
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

FIIs usam P/VP, DY, liquidez diaria e vacancia quando o relatorio gerencial
traz. Fundos usam rentabilidade contra CDI, volatilidade, patrimonio liquido e
cotistas, do informe diario da CVM. As colunas existem em `indicators`; as
formulas sao as mesmas, com entradas diferentes.

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
   screener exclui nulos da ordenacao por padrao.
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
autor, nao recomendacao.

Indices parciais em `pl`, `pvp`, `roe`, `dy_medio_5a`, `ev_ebit` e
`liquidez_diaria` cobrem os filtros mais usados. A meta de 300 ms para o
universo inteiro **ainda nao foi medida**: depende de haver universo carregado.

# ADR 0040 - Indicadores por ação: 12 meses, controladora e units

- **Status:** aceito
- **Data:** 2026-11-24
- **Decisores:** @leandrojtv

## Contexto

O P/L e o P/VP da KLBN11 saíam 60,36 e 7,03, contra cerca de 49 e 2,0 em outros
sites ([#114](https://github.com/leandrojtv/Bolsiq/issues/114)). Três erros se
somavam no recálculo do analytics:

1. **Units.** O preço da KLBN11 é o de 5 ações (1 ON + 4 PN), mas era dividido
   por LPA e VPA de uma ação. P/L, P/VP e Graham saíam multiplicados por 5. Vale
   para toda unit.
2. **Minoritários.** Patrimônio (2.03) e lucro (3.11) vinham do consolidado
   inteiro, com a parte dos não controladores. Na Klabin, 6,5 bi dos 14,4 bi de
   patrimônio são de minoritários.
3. **Defasagem.** Só o DFP anual entrava; em novembro de 2026 o indicador ainda
   usava o balanço de dezembro de 2025, com o ITR de setembro publicado.

## Decisão

- **Composição das units no market-data.** `GET /v1/assets/{ticker}` devolve
  `shares_per_unit` (KLBN11 = 5; nulo para quem não é unit). Nem COTAHIST nem
  CVM publicam a composição em arquivo, então ela fica numa tabela no código
  (`services/market-data/src/dados/units.ts`), conferida contra o preço das ações
  que formam cada unit. O analytics divide as ações em circulação por esse número:
  LPA, VPA, Graham e valor de mercado ficam na base do preço da unit.
- **Controladora.** `GET /v1/fundamentals` devolve `equity_parent` e
  `net_income_parent`, do demonstrativo individual (que, pela equivalência
  patrimonial, é o da controladora). LPA, VPA e ROE usam esses valores. EV,
  margens e endividamento continuam no consolidado, onde estão receita e dívida.
- **Último balanço e 12 meses.** Com ITR mais novo que o último DFP, o balanço é
  o do ITR e cada conta de resultado vira DFP do ano anterior + acumulado do ano
  − acumulado do mesmo período do ano anterior. A DRE do ITR vem por trimestre e é
  somada desde janeiro; o DFC (depreciação) já vem acumulado. Faltando algum
  trimestre, fica o DFP. A proveniência sai como `cvm-itr-12m:<data>:v<versão>`.

## Consequências

- O P/L passa a seguir a definição do IAS 33 (lucro dos acionistas da
  controladora). Sites que usam o lucro consolidado mostram outro número quando
  os minoritários pesam: na KLBN11, 290,9 contra cerca de 45, porque a
  controladora teve prejuízo de 530 mi no 1º trimestre de 2026 e lucro de
  69 mi em 12 meses.
- Unit nova na B3 precisa entrar na tabela; até lá, os indicadores dela saem como
  se o preço fosse de uma ação.
- O recálculo faz uma chamada a mais ao `/v1` por ticker (fundamentos trimestrais).

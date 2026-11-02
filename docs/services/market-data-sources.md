# market-data — fontes de dados

Uma seção por fonte: URL, formato, frequência, licença, direito de
redistribuição e mapeamento de campos.

> **Leia primeiro:** [a seção sobre licenças](#licenças-e-redistribuição) no fim
> deste documento. Uma das quatro fontes **não** pode ser redistribuída, e o
> plano de vender a API depende disso.

## Quadro geral

| Fonte                          | O que traz                                      | Formato                  | Frequência                | Licença                   | Pode redistribuir?                |
| ------------------------------ | ----------------------------------------------- | ------------------------ | ------------------------- | ------------------------- | --------------------------------- |
| CVM — cadastro                 | Companhias abertas: CNPJ, nome, setor           | CSV, latin1, `;`         | diária                    | ODbL                      | Sim, com atribuição e share-alike |
| CVM — DFP/ITR                  | Demonstrações anuais e trimestrais              | ZIP de CSVs, latin1, `;` | DFP anual, ITR trimestral | ODbL                      | Sim, com atribuição e share-alike |
| CVM — informe diário de fundos | NAV, patrimônio, aplicações, resgates, cotistas | ZIP mensal de CSV        | diária (arquivo mensal)   | ODbL                      | Sim, com atribuição e share-alike |
| B3 — COTAHIST                  | Preços históricos de todo o universo            | largura fixa, 245 bytes  | anual e diário            | Termos de Uso da B3       | **Não**                           |
| BCB — SGS                      | Selic, CDI, IPCA, IGP-M                         | JSON (API)               | diária e mensal           | aberta (confirmar termos) | Sim, com atribuição               |
| CVM — FCA                      | Ligação ticker → CNPJ                           | ZIP de CSVs, latin1, `;` | anual, com reapresentação | ODbL                      | Sim, com atribuição e share-alike |
| brapi                          | Cotação corrente e proventos                    | JSON (API)               | por consulta              | termos da brapi           | Verificar no contrato do plano    |

---

## 1. CVM — cadastro de companhias abertas

- **URL:** `https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv`
- **Catálogo:** https://dados.cvm.gov.br/dataset/cia_aberta-cad
- **Formato:** CSV, encoding `latin1` (ISO-8859-1), separador `;`, cabeçalho na primeira linha
- **Frequência:** diária, segundo o portal
- **Licença:** Licença Aberta para Bases de Dados (ODbL) do Open Data Commons

Arquivo único, sobrescrito. Não é incremental: cada carga é o retrato atual do
cadastro. Por isso o job faz `upsert`, nunca `insert`.

### Mapeamento para `assets`

| Coluna no CSV        | Coluna em `assets` | Observação                                          |
| -------------------- | ------------------ | --------------------------------------------------- |
| `CNPJ_CIA`           | `cnpj`             | normalizar: só dígitos, 14 caracteres               |
| `DENOM_SOCIAL`       | `legal_name`       | razão social                                        |
| `DENOM_COMERC`       | `name`             | nome de exibição; cair para `DENOM_SOCIAL` se vazio |
| `CD_CVM`             | `cvm_code`         | chave da CVM; é por ela que DFP/ITR se ligam        |
| `SETOR_ATIV`         | `sector`           | taxonomia da CVM, não a da B3                       |
| `SIT`                | `status`           | `ATIVO`, `CANCELADA` etc.                           |
| `DT_REG`             | `registered_at`    | data de registro na CVM                             |
| `CONTROLE_ACIONARIO` | `ownership_type`   | estatal, privado, estrangeiro                       |

**O cadastro não traz ticker.** Ele identifica a companhia (CNPJ e código CVM),
não os papéis negociados. A ligação CNPJ → ticker tem de vir de outra fonte, e
isso é uma lacuna a resolver antes do comparador funcionar: uma companhia tem N
tickers (ON, PN, UNT), e o COTAHIST traz ticker e ISIN, mas não CNPJ.

**Resolvido pelo FCA.** O Formulário Cadastral
(`DOC/FCA/DADOS/fca_cia_aberta_{ANO}.zip`, arquivo `_valor_mobiliario_`) lista
cada valor mobiliário da companhia com `CNPJ_Companhia` e `Codigo_Negociacao`.
O job `cvm-cadastro` cruza os dois arquivos e preenche `cnpj`, `cvm_code` e
setor dos papéis que o COTAHIST criou. Em 2026: 520 tickers no FCA, 382 ligados
a papéis negociados no universo; FIIs e ETFs não estão no FCA de companhias.

`CD_CVM` vem sem zeros à esquerda no cadastro (`9512`) e com seis dígitos no
DFP (`009512`). O adapter normaliza para seis.

---

## 2. CVM — DFP (anual) e ITR (trimestral)

- **URL DFP:** `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_{ANO}.zip`
- **URL ITR:** `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_{ANO}.zip`
- **Anos disponíveis:** 2010 a 2026 (verificado no índice do portal)
- **Formato:** ZIP contendo vários CSVs, `latin1`, separador `;`
- **Frequência:** DFP uma vez por ano; ITR a cada trimestre. Arquivos de anos
  passados ainda mudam, porque empresas reapresentam demonstrativos
- **Licença:** ODbL

Tamanho por ZIP: 8 MB a 13 MB (o do ano corrente é menor, por ser parcial).
Descomprimido, cada CSV passa de 100 MB — daí a leitura em streaming, nunca
`readFile`.

### CSVs dentro do ZIP

| Sufixo                  | Conteúdo                                 |
| ----------------------- | ---------------------------------------- |
| `_BPA_`                 | Balanço patrimonial ativo                |
| `_BPP_`                 | Balanço patrimonial passivo              |
| `_DRE_`                 | Demonstração do resultado                |
| `_DFC_MI_` / `_DFC_MD_` | Fluxo de caixa, método indireto / direto |
| `_DMPL_`                | Mutações do patrimônio líquido           |
| `_DVA_`                 | Valor adicionado                         |

Cada um vem em duas variantes: **individual** e **consolidado** (`_con_`). Para
análise de holding, o consolidado é o que importa; grave os dois e deixe a
escolha para a consulta.

### As duas regras que definem se o número está certo

Esta é a parte que mais se erra ao ler dados da CVM.

**1. Versão.** A coluna `VERSAO` indica a reapresentação. A mesma empresa, mesmo
exercício e mesma conta aparecem várias vezes, com versões 1, 2, 3. **Só vale a
maior versão.** Somar tudo multiplica a receita da empresa pelo número de
reapresentações.

**2. Ordem do exercício.** A coluna `ORDEM_EXERC` vale `ÚLTIMO` ou `PENÚLTIMO`.
Todo arquivo traz o exercício corrente **e** o anterior, para comparação. **Só
vale `ÚLTIMO`.** Sem esse filtro, cada ano é gravado duas vezes, uma delas com o
valor do ano anterior.

```sql
-- Regra, em SQL, do que entra em financial_statements
SELECT * FROM origem o
WHERE o.ordem_exerc = 'ÚLTIMO'
  AND o.versao = (
    SELECT MAX(i.versao) FROM origem i
    WHERE i.cd_cvm = o.cd_cvm
      AND i.dt_refer = o.dt_refer
      AND i.cd_conta = o.cd_conta
  );
```

Atenção ao acento: o valor é `ÚLTIMO`, com `Ú`. Comparar depois de decodificar
de `latin1`, não sobre os bytes.

### Mapeamento para `financial_statements`

| Coluna no CSV  | Coluna em `financial_statements` | Observação                                                |
| -------------- | -------------------------------- | --------------------------------------------------------- |
| `CNPJ_CIA`     | `cnpj`                           | só dígitos                                                |
| `CD_CVM`       | `cvm_code`                       | chave de junção com `assets`                              |
| `DT_REFER`     | `reference_date`                 | data-base, `timestamptz` em UTC                           |
| `DT_INI_EXERC` | `period_start`                   | ausente no balanço (é posição, não fluxo)                 |
| `DT_FIM_EXERC` | `period_end`                     |                                                           |
| `VERSAO`       | `version`                        | guardar, para auditoria                                   |
| `ORDEM_EXERC`  | —                                | usada no filtro, não gravada                              |
| `CD_CONTA`     | `account_code`                   | plano de contas da CVM, ex. `3.01`                        |
| `DS_CONTA`     | `account_label`                  |                                                           |
| `VL_CONTA`     | `amount`                         | **`numeric`**, nunca `float`                              |
| `ESCALA_MOEDA` | `scale`                          | `UNIDADE` ou `MIL`; **multiplicar por 1000 quando `MIL`** |
| `MOEDA`        | `currency`                       | sempre `REAL` na prática                                  |
| `GRUPO_DFP`    | `statement_type`                 | de onde sai `BPA`/`BPP`/`DRE`/`DFC`                       |
| —              | `is_consolidated`                | do nome do CSV, não de coluna                             |

`ESCALA_MOEDA` é a terceira armadilha: ignorá-la erra a escala por mil.

### Proveniência (regra 4 do CLAUDE.md)

| Campo        | Valor                                                     |
| ------------ | --------------------------------------------------------- |
| `source`     | `cvm-dfp` ou `cvm-itr`                                    |
| `fetched_at` | instante do download, UTC                                 |
| `license`    | `ODbL-1.0`                                                |
| `source_ref` | `dfp_cia_aberta_2023.zip#dfp_cia_aberta_DRE_con_2023.csv` |

---

## 3. CVM — informe diário de fundos

- **URL:** `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{AAAAMM}.zip`
- **Catálogo:** https://dados.cvm.gov.br/dataset/fi-doc-inf_diario
- **Formato:** ZIP com um CSV, `latin1`, separador `;`
- **Frequência:** o dado é diário, mas o **arquivo é mensal** e cresce ao longo
  do mês
- **Licença:** ODbL

A granularidade importa: o arquivo do mês corrente muda todo dia. Logo, o
`fetch_log` por hash faz o mês corrente reprocessar diariamente (correto) e os
meses fechados nunca mais (também correto).

### Mapeamento para `fund_daily` (hypertable)

| Coluna no CSV   | Coluna em `fund_daily` | Observação                                           |
| --------------- | ---------------------- | ---------------------------------------------------- |
| `CNPJ_FUNDO`    | `cnpj_fundo`           | só dígitos; parte da chave                           |
| `DT_COMPTC`     | `date`                 | data de competência; dimensão de tempo da hypertable |
| `VL_QUOTA`      | `nav`                  | valor da cota, `numeric`                             |
| `VL_PATRIM_LIQ` | `aum`                  | patrimônio líquido, `numeric`                        |
| `CAPTC_DIA`     | `inflows`              | captação do dia                                      |
| `RESG_DIA`      | `outflows`             | resgates do dia                                      |
| `NR_COTST`      | `holders`              | número de cotistas, inteiro                          |
| `VL_TOTAL`      | `total_portfolio`      | carteira a valor de mercado                          |

Chave natural: `(cnpj_fundo, date)`. É o que torna a reexecução idempotente.

A partir de 2021 a CVM passou a publicar o informe em arquivos separados por
classe de fundo em alguns períodos. O adapter precisa aceitar mais de um CSV por
ZIP em vez de assumir exatamente um.

---

## 4. B3 — COTAHIST

> ### Esta fonte não pode ser redistribuída
>
> Os Termos de Uso da B3 vedam redistribuição, sublicenciamento, revenda e
> prestação de serviços de difusão de dados a terceiros sem consentimento
> prévio e expresso. A página oficial da série histórica declara os dados como
> propriedade exclusiva da B3, destinados a consulta informativa, e **veda
> expressamente a coleta automatizada, inclusive por ferramentas de
> inteligência automatizada, para qualquer finalidade, comercial ou não**.
>
> Isso atinge dois pontos deste projeto ao mesmo tempo: o `B3CotahistAdapter`
> (coleta automatizada) e a venda da API (redistribuição). Ver
> [licenças e redistribuição](#licenças-e-redistribuição).

- **URL anual:** `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A{ANO}.ZIP`
- **URL diária:** `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D{DDMMAAAA}.ZIP`
- **Página oficial:** https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/
- **Formato:** texto de largura fixa, 245 bytes por registro, sem separador
- **Cobertura:** desde 1986
- **Frequência:** arquivo anual; diário ao fim de cada sessão

### Layout

Posições em bytes, começando em 1. **Validar contra o layout publicado pela B3
antes de usar em produção** — este quadro é o layout conhecido e não substitui o
documento oficial.

| Posição | Campo    | Tipo                              | Em `quotes_daily`  |
| ------- | -------- | --------------------------------- | ------------------ |
| 1–2     | `TIPREG` | tipo de registro (`01` = cotação) | filtro             |
| 3–10    | `DATA`   | `AAAAMMDD`                        | `date`             |
| 11–12   | `CODBDI` | código BDI (segmento)             | filtro             |
| 13–24   | `CODNEG` | ticker                            | `ticker`           |
| 25–27   | `TPMERC` | tipo de mercado                   | filtro             |
| 28–39   | `NOMRES` | nome resumido                     | —                  |
| 40–49   | `ESPECI` | especificação (ON, PN, UNT)       | `class`            |
| 57–69   | `PREABE` | abertura                          | `open`             |
| 70–82   | `PREMAX` | máxima                            | `high`             |
| 83–95   | `PREMIN` | mínima                            | `low`              |
| 96–108  | `PREMED` | média                             | `average`          |
| 109–121 | `PREULT` | fechamento                        | `close`            |
| 148–152 | `TOTNEG` | número de negócios                | `trades`           |
| 153–170 | `QUATOT` | quantidade negociada              | `volume`           |
| 171–188 | `VOLTOT` | volume financeiro                 | `financial_volume` |
| 211–217 | `FATCOT` | **fator de cotação**              | divisor            |
| 231–242 | `CODISI` | ISIN                              | `isin`             |

### As três conversões obrigatórias

1. **Preços vêm em centavos.** Todo campo `PRE*` tem duas decimais implícitas:
   `0000000001234` é `12,34`. Dividir por 100, em `numeric`.
2. **Fator de cotação.** `FATCOT` é 1 ou 1000 e diz se o preço se refere a uma
   unidade ou a um lote de mil. Ignorá-lo erra o preço por mil em papéis
   antigos e em alguns direitos de subscrição. Preço unitário =
   `PRE* / 100 / FATCOT`.
3. **`CODBDI` e `TPMERC` definem o universo.** `CODBDI = 02` é lote padrão à
   vista; `TPMERC = 010` é mercado a vista. Sem filtrar, entram opções, termo,
   leilão e fracionário, e o universo infla várias vezes.

### Proveniência e ajuste

| Campo        | Valor                                              |
| ------------ | -------------------------------------------------- |
| `source`     | `b3-cotahist`                                      |
| `license`    | `proprietária — B3, sem direito de redistribuição` |
| `source_ref` | `COTAHIST_A2023.ZIP`                               |

O COTAHIST **não** é ajustado por proventos: a própria B3 informa que as
cotações vêm na moeda e forma da época, sem ajuste por inflação ou proventos.
Logo, `close` é o preço bruto e `adj_close` é calculado, recalculado a cada
evento novo. A fonte dos eventos (desdobramento, bonificação, dividendo) ainda
não está definida — mais uma pendência.

---

## 5. BCB — séries SGS

- **URL:** `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{CODIGO}/dados?formato=json&dataInicial={dd/MM/aaaa}&dataFinal={dd/MM/aaaa}`
- **Formato:** JSON, `{"data":"dd/MM/aaaa","valor":"0.050788"}`
- **Licença:** portal de dados abertos do BCB; confirmar os termos exatos antes
  de redistribuir

### Séries, verificadas na API em 2026-11-01

| Código | Série           | Unidade       | Frequência | Valor de conferência     |
| ------ | --------------- | ------------- | ---------- | ------------------------ |
| `11`   | Selic           | % no dia útil | diária     | `0.050788` em 30/10/2026 |
| `12`   | CDI             | % no dia útil | diária     | `0.050788` em 29/10/2026 |
| `432`  | Selic meta      | % a.a.        | diária     | `13.75` em 04/11/2026    |
| `433`  | IPCA            | % no mês      | mensal     | `0.82` em 01/09/2026     |
| `189`  | IGP-M           | % no mês      | mensal     | `1.47` em 01/10/2026     |
| `4389` | Selic acumulada | % a.a.        | diária     | `13.65` em 29/10/2026    |
| `4391` | CDI acumulado   | % no mês      | mensal     | `1.02` em 01/10/2026     |

Para benchmark de retorno, o que serve é **12** (CDI diário) e **11** (Selic
diária), porque compõem no dia útil. A série **432** é a meta definida pelo
Copom, não o que rendeu — usá-la como benchmark erra o retorno. Note que 432
traz data futura, por carregar a meta vigente adiante.

### Mapeamento para `macro_series` (hypertable)

| Origem          | Coluna em `macro_series` | Observação                                   |
| --------------- | ------------------------ | -------------------------------------------- |
| código da série | `series_code`            | ex. `12`; parte da chave                     |
| `data`          | `date`                   | **`dd/MM/aaaa`**, não ISO; dimensão de tempo |
| `valor`         | `value`                  | string no JSON; converter para `numeric`     |
| —               | `unit`                   | da tabela acima, não da API                  |
| —               | `frequency`              | `daily` ou `monthly`                         |

Chave natural: `(series_code, date)`.

### Duas armadilhas

1. **Data em `dd/MM/aaaa`.** Passar direto para `new Date()` interpreta como
   `MM/dd` e silenciosamente embaralha os doze primeiros dias de cada mês.
2. **Janela longa devolve HTTP 406.** Série diária com intervalo grande é
   rejeitada. Fatiar a carga histórica em janelas de até 3 anos e tratar 406
   como "fatiar mais", não como erro definitivo.

---

## 6. brapi — cotação corrente e proventos

- **URL:** `https://brapi.dev/api/quote/{ticker}` (`?dividends=true` para
  proventos, `?range=&interval=1d` para série)
- **Formato:** JSON; preço como `number`, convertido para string decimal na
  borda do adapter, sem aritmética de ponto flutuante
- **Autenticação:** `Authorization: Bearer $BRAPI_TOKEN`. Sem token, só os
  tickers de demonstração (PETR4, VALE3, ITUB4, MGLU3); os demais respondem 401
- **Atraso:** cotação com atraso de cerca de 15 minutos no plano gratuito
- **Licença:** termos de uso da brapi; o dado de origem é da B3

### Mapeamento de proventos para `dividends`

| Campo da brapi           | Coluna            | Observação                                                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------ |
| `label`                  | `kind`            | DIVIDENDO, JCP, RENDIMENTO, BONIFICACAO, DESDOBRAMENTO, GRUPAMENTO |
| `exDate` ou data-com + 1 | `ex_date`         | `exDate` vem nulo em parte dos registros                           |
| `rate`                   | `value_per_share` | dinheiro: dividendo e JCP                                          |
| `factor`                 | `factor`          | multiplicador de ações: 2 em "2 para 1", 1.1 em bonificação de 10% |
| `completeFactor`         | `ratio`           | texto como publicado                                               |

Conferido em ITUB4, MGLU3 e VALE3: `factor` já é o multiplicador, inclusive na
bonificação. Rótulos fora da lista (por exemplo `CIS RED CAP`) são ignorados.

Datas da brapi vêm em UTC às 03:00, que é meia-noite em São Paulo. O adapter
converte no fuso de São Paulo antes de cortar a data.

### IBOV

O índice não tem fonte aberta: o SGS parou a série 7 (Ibovespa) em 2019, e a
brapi exige token para `^BVSP`. Com token, `/v1/macro/ibov` usa a brapi; sem,
usa o fechamento do BOVA11 do COTAHIST, com a unidade dizendo que é
aproximação. Para benchmark de retorno, a diferença é a taxa do ETF.

## Licenças e redistribuição

O projeto pretende vender o `market-data` como API pública. Isso transforma a
licença de cada fonte em requisito de produto, não em nota de rodapé.

### CVM — ODbL

As três fontes da CVM estão sob **Licença Aberta para Bases de Dados (ODbL) do
Open Data Commons**, confirmado no catálogo do portal. A ODbL permite uso
comercial, e impõe duas obrigações:

- **Atribuição.** A resposta da API precisa creditar a CVM. É isso que o campo
  `license` na proveniência sustenta.
- **Share-alike.** Banco derivado distribuído publicamente deve ser oferecido
  sob a mesma licença.

O share-alike é o ponto a examinar com cuidado jurídico: há diferença entre
_produce a work_ (servir resultados de consulta, em geral fora da obrigação) e
_distribuir um banco derivado_ (que a aciona). Uma API que devolve consultas
tende a ser o primeiro caso; um dump para download é o segundo. **Não é uma
conclusão que eu possa dar — é conversa com advogado**, e vale ter a resposta
antes de haver cliente pagante.

### B3 — proprietária, sem redistribuição

Os Termos de Uso da B3 vedam redistribuição, sublicenciamento, revenda e difusão
de dados a terceiros sem consentimento prévio e expresso, e a página da série
histórica veda a coleta automatizada para qualquer finalidade.

Consequência direta: **preço de ação não pode sair da API pública** enquanto não
houver contrato de distribuição de market data com a B3. E isso atinge
exatamente o núcleo do produto — um comparador de ativos sem preço de ação não
é um comparador de ativos.

O que isso significa na prática:

| Uso                                                        | Situação                                    |
| ---------------------------------------------------------- | ------------------------------------------- |
| Baixar COTAHIST manualmente e analisar internamente        | Uso informativo; é o que a página prevê     |
| Coletar por job automatizado                               | Vedado pelos termos, mesmo sem redistribuir |
| Servir preço de ação na API pública                        | Redistribuição; exige contrato              |
| Servir indicador derivado (volatilidade, correlação, beta) | Zona cinzenta; depende do contrato          |

Caminhos, em ordem de custo:

1. **Contrato de market data com a B3.** O caminho correto para o produto como
   desenhado. Há custo e prazo; a B3 tem política comercial específica. Existe
   minuta pública de contrato de distribuição, que serve para dimensionar, não
   como base legal.
2. **Fornecedor licenciado.** Comprar de quem já tem o direito de redistribuir
   (o CLAUDE.md já cita FMP e EODHD como futuro). Custo recorrente, mas resolve
   a questão legal e elimina o adapter de COTAHIST.
3. **Começar sem preço de ação.** Fundos, demonstrações financeiras e
   benchmarks macro vêm todos de fonte redistribuível. Dá um comparador de
   fundos completo e análise fundamentalista completa, sem preço de ação. É a
   única das três que não depende de contrato nem de orçamento.

### BCB

Portal de dados abertos, com atribuição. Não achei a página oficial que declara
os termos exatos — o que circula vem de bibliotecas de terceiros. Confirmar
antes de redistribuir, embora o risco seja baixo por se tratar de estatística
pública.

### Resumo

| Fonte                           | Uso interno | Redistribuir na API                     |
| ------------------------------- | ----------- | --------------------------------------- |
| CVM (cadastro, DFP/ITR, fundos) | Sim         | Sim, com atribuição; checar share-alike |
| BCB (SGS)                       | Sim         | Sim, com atribuição; confirmar termos   |
| B3 (COTAHIST)                   | Informativo | **Não, sem contrato**                   |

---

## Pendências

1. ~~Ligação CNPJ → ticker~~: resolvida pelo FCA (seção 1).
2. ~~Fonte de proventos~~: brapi (seção 6). Sem token, só os tickers de
   demonstração; com token, o universo.
3. **Licença da B3.** Decisão de negócio, não técnica, e bloqueia o núcleo do
   produto.
4. **Share-alike da ODbL.** Pergunta jurídica, melhor respondida antes do
   primeiro cliente.
5. **Termos do BCB.** Confirmar na fonte oficial.

## Fontes

- [B3 — Cotações históricas](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/)
- [B3 — Termos de Uso](https://www.b3.com.br/pt_br/termos-de-uso-e-protecao-de-dados/termos-de-uso/)
- [B3 — minuta de contrato de distribuição de market data](https://www.b3.com.br/data/files/83/37/19/FC/81005610BE423F46AC094EA8/Contrato-de-Distribuicao-de-Market-Data-DRAFT.pdf)
- [CVM — cadastro de companhias abertas](https://dados.cvm.gov.br/dataset/cia_aberta-cad)
- [CVM — DFP](https://dados.cvm.gov.br/dataset/groups/cia_aberta-doc-dfp)
- [CVM — ITR](https://dados.cvm.gov.br/dataset/groups/cia_aberta-doc-itr)
- [CVM — informe diário de fundos](https://dados.cvm.gov.br/dataset/groups/fi-doc-inf_diario)
- [CVM — índice de arquivos](https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/)
- [BCB — portal de dados abertos](https://dadosabertos.bcb.gov.br/)

# Prompt de normalização de extratos

Regras para converter extratos de corretoras nos layouts do Bolsiq: posição
(`posicao_bolsiq`), transações e proventos. O layout completo está em
[docs/services/portfolio.md](../services/portfolio.md#layout-de-posicao).

Este arquivo é a **fonte única** das regras. Elas valem em dois lugares:

- **Importar com IA**, na tela da carteira: os blocos "Regras" e "Formato da resposta
  da importação com IA" abaixo viram o prompt de sistema versionado em
  `packages/assistant/prompts/importacao-regras.ts`. Mudou o
  bloco, rode `pnpm --filter @bolsiq/assistant run prompt:importacao` (ou
  `make prompt-importacao`), suba a versão em `prompts/importacao-v1.ts` se o
  comportamento mudar e rode `make eval-importacao`. Um teste falha se o arquivo
  gerado divergir deste bloco. Detalhes em
  [docs/services/importacao-ia.md](../services/importacao-ia.md).
- **Uso manual**, num assistente de IA qualquer: copie o bloco "Saída em CSV" e, em
  seguida, o bloco "Regras", e cole os extratos no fim.

Confira o total por corretora na tela de revisão antes de confirmar: o assistente
pode errar, e o extrato é a referência.

## Saída em CSV (uso manual)

```text
Você vai converter extratos de posição de corretoras em um único CSV.

Saída: somente o CSV, em UTF-8, separador vírgula, ponto decimal, sem separador de
milhar, sem texto antes ou depois. Campo com vírgula vai entre aspas duplas. A
primeira linha é exatamente:

data_posicao,corretora,classe,subclasse,ativo,codigo,cnpj,emissor,indexador,pct_indexador,taxa_aa,data_aplicacao,vencimento,liquidez_diaria,quantidade,preco_unitario,preco_medio,valor_aplicado,saldo_bruto,ir,iof,saldo_liquido,valorizacao,observacao

Ao final, depois de gerar o CSV, confira que a soma de saldo_bruto de cada corretora
é igual ao total do extrato. Se não for, aponte a diferença em vez de ajustar.

Siga as regras abaixo. Extratos no fim.
```

## Regras

<!-- regras-importacao:inicio -->

```text
Uma linha por ativo. Regras por coluna da posição:

- data_posicao: data de referência do extrato, AAAA-MM-DD. Uma única data por
  corretora.
- corretora: sempre com a mesma grafia entre cargas (XP, Nubank, Santander, BTG,
  Itaú, Rico, Clear, Inter).
- classe: acao, fii, bdr, etf, renda_fixa, titulo_publico, fundo, previdencia, coe,
  estruturado, cripto ou outro.
- subclasse: a categoria do extrato (Pós-Fixado, Inflação, Ouro...).
- ativo: o nome como aparece no extrato.
- codigo: ticker em acao, fii, bdr e etf (obrigatório). Em titulo_publico, tipo e
  vencimento, como NTNB_2030-08-15 (obrigatório). Em coe, o código do extrato.
- cnpj: em fundo e previdencia, se o extrato trouxer.
- emissor: em renda_fixa e coe, o banco ou a empresa emissora.
- indexador: CDI, SELIC, IPCA, IGPM, PRE ou vazio.
- pct_indexador: percentual do indexador em fração. 120% do CDI é 1.20.
- taxa_aa: taxa ao ano em fração. 14,69% é 0.1469; IPCA + 7,95% é 0.0795.
- data_aplicacao e vencimento: AAAA-MM-DD.
- liquidez_diaria: S, N ou vazio.
- quantidade: obrigatória em acao, fii, bdr e etf.
- preco_unitario: preço ou PU na data do extrato.
- preco_medio: preço médio de aquisição, na renda variável.
- valor_aplicado: valor investido.
- saldo_bruto: obrigatório em toda linha. Saldo antes de impostos.
- ir, iof, saldo_liquido: como no extrato.
- valorizacao: cotacao_b3 (renda variável), curva (renda fixa), tesouro (título
  público), cota_cvm (fundo e previdência), manual (coe e demais).
- observacao: o que faltou ou ficou duvidoso, em poucas palavras.

Números com ponto decimal e sem separador de milhar: R$ 1.234,56 é 1234.56.

Nunca invente valor. Campo que o extrato não traz fica vazio, e a falta vai em
observacao quando importar (CNPJ de fundo, taxa, data de aplicação). Não calcule
saldo nem taxa. Não some linhas de ativos diferentes; aplicações do mesmo título
com as mesmas condições viram uma linha só, com os valores somados.

Saldo em conta corrente, saldo projetado e valores a liquidar não são posição: não
viram linha.

Transações (extrato de negociação, movimentação):

- data: AAAA-MM-DD, a data do negócio.
- ticker: o código de negociação, sem o F do fracionário (PETR4F é PETR4).
- tipo: compra ou venda. Transferência, empréstimo e subscrição não viram
  transação: vão em avisos.
- quantidade e preco: como no documento, preço unitário.
- taxas: as taxas da operação, se o documento trouxer por operação; senão 0.
- corretora: a do documento.
- ativo_no_documento: o nome do papel quando o documento não traz o ticker
  (PETROBRAS PN N2).

Nota de corretagem (SINACOR):

- Cada negócio vira uma transação de compra (C) ou venda (V), com o número da nota
  em nota. Use o ticker quando souber com certeza; senão deixe o nome do papel em
  ativo_no_documento e marque confiança baixa.
- Não rateie taxas: deixe taxas em 0. O Bolsiq rateia pelo volume.
- Para cada nota, em notas: número, data do pregão, taxas_total (liquidação,
  registro, emolumentos, corretagem, ISS e outras, sem o IRRF), irrf, valor_liquido
  e sentido_liquido (debito quando o cliente paga, credito quando recebe).

Proventos (dividendos, JCP, rendimentos):

- data_pagamento AAAA-MM-DD, ticker, tipo (dividendo, jcp, rendimento ou outro),
  quantidade de cotas ou ações, valor_por_cota e valor_total, como no documento.
- tipo pelo texto do documento: DIVIDENDO é dividendo; JUROS SOBRE CAPITAL PROPRIO
  ou JCP é jcp; RENDIMENTO (FII) é rendimento.
- Valor líquido de IR quando o documento trouxer os dois (JCP traz bruto e
  líquido: valor_total é o líquido).
- Proventos provisionados, a receber ou com pagamento futuro, mesmo dentro de um
  extrato de posição (uma tabela com ticker, quantidade, valor e data de pagamento
  na aba ou página da carteira), são proventos: viram linha em proventos, com a data
  de pagamento prevista. Nunca viram posição nem transação. Não deixe de fora por a
  data ser futura: o Bolsiq separa os que ainda não foram pagos.

Documento:

- tipo: posicao, transacoes, nota_corretagem, proventos ou misto.
- corretora e data_referencia (AAAA-MM-DD).
- totais_declarados: todo total que o documento declara (patrimônio total, total
  por classe, total da nota), com a descrição como está no documento e o valor.
  Só totais escritos no documento; nunca some você mesmo.

Origem e confiança, em toda linha:

- pagina_ou_aba: o marcador do bloco de onde a linha saiu, igual ao do documento
  ("página 2", "aba Ações", "texto").
- trecho_original: o trecho do documento com o ativo e os valores da linha, copiado
  sem mudar nada, até 200 caracteres.
- confianca: alta quando tudo está escrito no documento; media quando houve
  interpretação (classe deduzida, coluna sem cabeçalho); baixa quando há dúvida.

O que não conseguir interpretar vai em avisos, em poucas palavras.
```

<!-- regras-importacao:fim -->

## Formato da resposta da importação com IA

Só vale na tela (a importação com IA). As linhas voltam em CSV de texto, não em JSON
estruturado: o schema estrito de 26 campos por linha passa do limite de gramática dos
provedores ([ADR 0026](../adr/0026-importacao-com-ia.md#revisão)).

<!-- formato-importacao:inicio -->

````text
Responda só com blocos CSV, um por tipo de linha presente no documento, nesta ordem:
posicoes, transacoes, proventos, notas. Tipo que não aparece no documento: não escreva
o bloco. Nada fora dos blocos.

Cada bloco abre com ```csv <tipo> e fecha com ```. A primeira linha é exatamente o
cabeçalho abaixo. Separador ponto e vírgula. Campo com ponto e vírgula ou aspas vai
entre aspas duplas, com as aspas internas duplicadas. Uma linha por registro, sem
quebra de linha dentro do campo. Campo sem valor fica vazio.

```csv posicoes
data_posicao;corretora;classe;subclasse;ativo;codigo;cnpj;emissor;indexador;pct_indexador;taxa_aa;data_aplicacao;vencimento;liquidez_diaria;quantidade;preco_unitario;preco_medio;valor_aplicado;saldo_bruto;ir;iof;saldo_liquido;valorizacao;observacao;pagina_ou_aba;trecho_original;confianca
2026-10-31;XP;acao;;PETR4;PETR4;;;;;;;;;100;38.42;32.50;;3842.00;;;;cotacao_b3;;aba Ações;"PETR4;100;32.5;38.42;3842";alta
2026-10-31;XP;renda_fixa;Pós-Fixado;"CDB BANCO ALFA; SET/2028";;;BANCO ALFA S.A.;CDI;1.10;;2025-09-15;2028-09-15;;;;;10000;11234.56;210.12;0;11024.44;curva;;aba Renda Fixa;"CDB BANCO ALFA; SET/2028 110% CDI 11234.56";alta
```

```csv transacoes
data;ticker;tipo;quantidade;preco;taxas;corretora;ativo_no_documento;nota;pagina_ou_aba;trecho_original;confianca
2026-10-15;PETR4;compra;200;37.50;0;XP;PETROBRAS PN N2;123456;página 1;1-BOVESPA C VISTA PETROBRAS PN N2 200 37,50 7.500,00 D;media
```

```csv proventos
data_pagamento;ticker;tipo;quantidade;valor_por_cota;valor_total;corretora;pagina_ou_aba;trecho_original;confianca
2026-10-15;PETR4;dividendo;100;;85.00;XP;aba Proventos;"15/10/2026;PETR4;Dividendos;100;85";alta
```

```csv notas
numero;data_pregao;corretora;taxas_total;irrf;valor_liquido;sentido_liquido;pagina_ou_aba;trecho_original
123456;2026-10-15;XP;3.66;0.11;8663.77;debito;página 1;Líquido para 17/10/2026 8.663,77 D
```
````

<!-- formato-importacao:fim -->

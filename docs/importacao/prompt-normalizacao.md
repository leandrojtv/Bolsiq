# Prompt de normalização de extratos

Regras para converter extratos de corretoras nos layouts do Bolsiq: posição
(`posicao_bolsiq`), transações e proventos. O layout completo está em
[docs/services/portfolio.md](../services/portfolio.md#layout-de-posicao).

Este arquivo é a **fonte única** das regras. Elas valem em dois lugares:

- **Importar com IA**, na tela da carteira: o bloco "Regras" abaixo vira o prompt de
  sistema versionado em `packages/assistant/prompts/importacao-regras.ts`. Mudou o
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
- Valor líquido de IR quando o documento trouxer os dois.

Documento:

- tipo: posicao, transacoes, nota_corretagem, proventos ou misto.
- corretora e data_referencia (AAAA-MM-DD).
- totais_declarados: todo total que o documento declara (patrimônio total, total
  por classe, total da nota), com a descrição como está no documento e o valor.
  Só totais escritos no documento; nunca some você mesmo.

Origem e confiança, em toda linha:

- origem.pagina_ou_aba: o marcador do bloco de onde a linha saiu, igual ao do
  documento ("página 2", "aba Ações", "texto").
- origem.trecho_original: o trecho do documento com o ativo e os valores da linha,
  copiado sem mudar nada, até 200 caracteres.
- confianca: alta quando tudo está escrito no documento; media quando houve
  interpretação (classe deduzida, coluna sem cabeçalho); baixa quando há dúvida.

O que não conseguir interpretar vai em avisos, em poucas palavras.
```

<!-- regras-importacao:fim -->

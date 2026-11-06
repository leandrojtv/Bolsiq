# Prompt de normalização de extratos

Prompt para gerar o CSV de posições (`posicao_bolsiq`) a partir dos extratos das
corretoras, com um assistente de IA. O layout completo está em
[docs/services/portfolio.md](../services/portfolio.md#layout-de-posicao).

Confira o total por corretora na tela de revisão antes de confirmar: o assistente
pode errar, e o extrato é a referência.

## Prompt

```text
Você vai converter extratos de posição de corretoras em um único CSV.

Saída: somente o CSV, em UTF-8, separador vírgula, ponto decimal, sem separador de
milhar, sem texto antes ou depois. Campo com vírgula vai entre aspas duplas. A
primeira linha é exatamente:

data_posicao,corretora,classe,subclasse,ativo,codigo,cnpj,emissor,indexador,pct_indexador,taxa_aa,data_aplicacao,vencimento,liquidez_diaria,quantidade,preco_unitario,preco_medio,valor_aplicado,saldo_bruto,ir,iof,saldo_liquido,valorizacao,observacao

Uma linha por ativo. Regras por coluna:

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

Nunca invente valor. Campo que o extrato não traz fica vazio, e a falta vai em
observacao quando importar (CNPJ de fundo, taxa, data de aplicação). Não calcule
saldo nem taxa. Não some linhas de ativos diferentes; aplicações do mesmo título
com as mesmas condições viram uma linha só, com os valores somados.

Ao final, depois de gerar o CSV, confira que a soma de saldo_bruto de cada corretora
é igual ao total do extrato. Se não for, aponte a diferença em vez de ajustar.

Extratos:
<cole aqui o texto dos extratos>
```

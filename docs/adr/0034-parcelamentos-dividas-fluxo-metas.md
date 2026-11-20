# ADR 0034 - Bolsiq Finanças: parcelamentos, dívidas, orçamento, fluxo projetado e metas

- **Status:** aceito
- **Data:** 2026-11-20
- **Decisores:** @leandrojtv

Complementa os ADRs [0031](0031-bolsiq-financas.md), [0032](0032-importacao-ofx-financas.md)
e [0033](0033-faturas-recorrencias-planejamento.md).

## Contexto

Faltava saber de compra parcelada, empréstimo e financiamento, o estado do orçamento
por categoria, a projeção do caixa nos próximos meses e metas de poupança.

## Decisão

**Plano de parcelamento** (`installment_plans`) para cartão (sem juros), empréstimo e
financiamento (Price ou SAC). Cada parcela é um lançamento com `installment_plan_id` e
`parcela_numero` (único por plano).

- **Cartão**: "10x de R$ 120" cria o plano e uma parcela em cada fatura pelo ciclo; a
  primeira tem a data da compra, as outras a data de fechamento da fatura delas. Total
  informado divide em centavos com o resíduo na primeira. Ao fechar a fatura, o que
  estava previsto nela (parcela, assinatura) vira realizado.
- **Dívida**: tabela Price ou SAC em `decimal.js`, juros arredondados a centavos por
  linha e resíduo na última, conferida contra tabelas calculadas à parte. As parcelas
  viram previstos na conta pagadora; as de datas passadas entram como realizadas.
- **Saldo devedor derivado do histórico** (parcelas realizadas e amortizações
  extras), não guardado: continua certo depois de amortizar.
- **Amortização extra**: simulador (reduzir prazo mantendo a parcela na Price ou a
  amortização na SAC; reduzir parcela mantendo o prazo) com os juros economizados;
  registrar grava o extra como lançamento do plano sem número de parcela e refaz as
  previstas restantes. Quitar a dívida é amortizar o saldo inteiro; quitar o cartão
  antecipa as parcelas restantes para a fatura atual.

**Importação com parcela detectada.** Antes da busca de lançamento manual parecido,
procura a parcela prevista de um plano compatível (mesmo cartão, descrição
normalizada igual, valor a 1 centavo, número esperado, ainda sem FITID): a linha vem
como "conciliar" e a confirmação marca a parcela como realizada na fatura importada.
Sem plano, a confirmação cria o plano a partir da parcela atual e gera só as restantes
nas faturas seguintes; desfazer a importação apaga o plano que ficou vazio.

**Orçamento é o planejamento.** Não há tabela `budgets` separada: o orçamento por
categoria e mês é o planejamento do ADR 0033 (`budget_items`), que ganha os estados
(ok; atenção a partir de 80%; estourado acima de 100% do consumo, realizado mais
previsto), edição inline do valor da categoria (gravado no item geral da categoria,
sem descrição) e a sugestão pela média do realizado dos últimos 3 meses.
`/financas/orcamento` abre o planejamento. Duas tabelas para o mesmo número iriam
divergir.

**Fluxo de caixa projetado** (3 a 12 meses): saldo realizado das contas hoje, mais os
previstos nas contas (receitas, despesas, parcelas de dívida, pagamento de fatura já
previsto), mais as faturas futuras sem pagamento previsto no vencimento (compras e
parcelas no cartão), mais as recorrências além do horizonte de 90 dias do job. O que
está atrasado entra no primeiro mês. Devolve entradas, saídas e saldo por mês e o
primeiro mês negativo.

**Metas** (`goals`): valor e data alvo, acompanhadas pelo saldo de uma conta, por uma
carteira do Bolsiq ou por um valor guardado informado à mão. A carteira é referência
lógica (`portfolio_id` sem FK entre schemas): o web passa ao finance uma função que
lê o patrimônio pelo módulo `portfolio`. Valor mensal necessário: o que falta dividido
pelos meses até a data alvo (no mínimo um).

## Consequências

- O mesmo gasto parcelado aparece uma vez por parcela, na fatura em que é cobrado, e
  conta no orçamento no mês da parcela.
- A conciliação de parcela depende da descrição normalizada do banco bater com a do
  plano; plano lançado à mão com outro nome não casa e a parcela importada vira um
  plano novo (o usuário apaga um dos dois).
- O fluxo projetado é tão bom quanto os previstos: gasto variável sem recorrência nem
  planejamento não entra.

## Alternativas consideradas

- **Tabela `budgets` separada do planejamento.** Pedida no prompt; dois lugares para o
  mesmo valor por categoria e mês.
- **Guardar o saldo devedor no plano.** Mais simples de ler, e erra depois de editar ou
  apagar uma parcela realizada.

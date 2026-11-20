# ADR 0033 - Bolsiq Finanças: faturas, recorrências, painel do mês e planejamento

- **Status:** aceito
- **Data:** 2026-11-19
- **Decisores:** @leandrojtv

Complementa os ADRs [0031](0031-bolsiq-financas.md) e
[0032](0032-importacao-ofx-financas.md).

## Contexto

O ADR 0032 trouxe cartões e faturas no mínimo que a importação precisava. Falta a
fatura fechar e ser paga, os lançamentos que se repetem (salário, aluguel,
assinaturas), o dashboard do mês e um lugar para planejar o mês sem mexer nos
lançamentos.

## Decisão

**Ciclo da fatura.** Compra feita **até o dia do fechamento, inclusive**, entra na
fatura do ciclo; depois, na seguinte. Isto corrige o ADR 0032, que mandava a compra do
dia do fechamento para a próxima. Dia maior que o último do mês vira o último dia.
A fatura (`statements`) é criada sob demanda na primeira compra do ciclo e ganhou
`competencia`, `status` (`aberta`, `fechada`, `paga`), `total_informado` (o LEDGERBAL
da importação) e `pagamento_id`. Os nomes do pedido original (`card_statements`,
`ultimos_4`, `account_id_pagamento`) ficaram como já estavam (`statements`, `final`,
`account_id`) para não renomear tabela e coluna já em produção.

**Pagamento é transferência, nunca despesa.** As despesas são as compras; o pagamento
sai da conta pagadora e entra no cartão. Assim o mesmo gasto não conta duas vezes.
A fatura fechada gera o pagamento **previsto** na conta pagadora, na data de
vencimento, com o total menos o já pago; compra lançada depois do fechamento com data
do ciclo atualiza o previsto. Pagar transforma o previsto em realizado (com a data, o
valor e a conta informados) ou cria a transferência realizada.

**Recorrências.** `recurrences` (mensal pelo dia do mês, semanal pelo dia da semana,
anual no mês do início; fim opcional; valor variável). O job diário
`finance.rotina-diaria` no `portfolio-worker` (pg-boss, `FINANCE_ROTINA_CRON`, e uma
vez ao subir) gera os previstos até 90 dias e fecha as faturas vencidas. A
idempotência é o índice único parcial `(recurrence_id, data)` em `transactions` com
`ON CONFLICT DO NOTHING`. Criar a recorrência já gera os previstos; editar apaga os
previstos futuros não realizados e gera de novo; com `valor_variavel`, os previstos
usam o último valor realizado. O job lista os usuários como superusuário (só os ids)
e processa cada um em `comoUsuario`, com a RLS valendo.

**Painel do mês** (`/api/financas/painel`): renda prevista x recebida, despesas pagas
x a pagar, saldo previsto do fim do mês (contas, com os previstos), fixos x variáveis
pelo `tipo_custo` da categoria e em % da renda, saldo por conta, faturas não pagas,
top 5 categorias e o que vence em 7 dias (mais os atrasados). Transferência nunca é
receita nem despesa.

**Planejamento** (`budget_items`, `/financas/planejamento`): orçamento mensal por
categoria, com descrição opcional, valor e a marca de fixo. **Não cria nem altera
lançamento**: a tela compara o planejado com o realizado e o previsto do mês, por
categoria, com a sobra planejada. Dá para copiar o mês anterior e puxar as
recorrências como itens fixos; os dois não duplicam (único por mês, categoria e
descrição, `NULLS NOT DISTINCT`).

Recorrência e planejamento são coisas diferentes de propósito: a recorrência é o que
**vai acontecer** e por isso vira lançamento previsto e mexe no saldo previsto; o
planejamento é **quanto se pretende** gastar ou receber e não mexe em nada.

## Consequências

- O gasto no cartão aparece uma vez: na compra. Teste de unidade, de integração e
  E2E conferem que pagar a fatura não muda a despesa do mês.
- O saldo previsto e a lista "a pagar" dependem do job ter rodado; criar ou editar a
  recorrência já gera os previstos, então o job só cobre a janela que anda.
- Fatura que muda depois de paga (estorno tardio) não reabre sozinha; o usuário vê
  a diferença entre total e pago no detalhe.
- O planejamento compara por competência do lançamento: compra no cartão conta no mês
  da compra, não no da fatura.

## Alternativas consideradas

- **Planejamento como lançamentos previstos.** Misturaria o que se pretende com o que
  vai acontecer, e o saldo previsto passaria a contar desejo como certeza.
- **Pagamento de fatura como despesa e compras fora do total.** É como o extrato da
  conta mostra, mas esconde em que se gastou e quebra o orçamento por categoria.
- **Gerar os previstos sob demanda ao abrir a tela.** Sem job, o saldo previsto e o
  "a pagar" ficariam errados para quem não abre o app.

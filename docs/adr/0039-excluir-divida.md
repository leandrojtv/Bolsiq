# ADR 0039 - Bolsiq Finanças: excluir empréstimo ou financiamento

- **Status:** aceito
- **Data:** 2026-11-22
- **Decisores:** @leandrojtv

Complementa o [ADR 0034](0034-parcelamentos-dividas-fluxo-metas.md).

## Contexto

A tela de dívidas permitia cadastrar, simular, amortizar e quitar, mas não excluir.
Quem cadastrou um financiamento errado (taxa, prazo, conta) ou desistiu de acompanhar
não tinha saída. Excluir mexe em dois tipos de lançamento do plano: as parcelas
previstas (futuras, ainda não pagas) e os lançamentos já realizados (parcelas pagas e
amortizações extras), que já entraram no saldo da conta e no histórico do orçamento.

## Decisão

`DELETE /api/financas/dividas/{id}` exclui o empréstimo ou financiamento, numa
transação, com o RLS do usuário:

- **Parcelas previstas são apagadas.** São projeção do plano; sem o plano, deixariam
  no fluxo projetado e no orçamento uma dívida que não existe mais.
- **Lançamentos realizados ficam, desvinculados.** Parcelas pagas e amortizações
  extras continuam na conta com a mesma data, valor, categoria e descrição, mas com
  `installment_plan_id` e `parcela_numero` nulos. O dinheiro saiu de fato: apagar
  mudaria o saldo da conta e os meses passados.
- **O plano some** (`installment_plans`), com um registro `divida.apagada` na
  auditoria com as contagens.
- A resposta traz `previstas_apagadas` e `realizados_desvinculados`, e a tela usa os
  números na confirmação e no aviso depois de excluir.
- **Só dívida.** Compra parcelada no cartão responde 422 nessa rota; ela continua
  saindo por `DELETE /api/financas/parcelamentos/{id}`, que aplica a mesma regra.
- Plano de outro usuário responde 404 (não existe para quem pede).

A interface pede confirmação num painel que diz quantas previstas serão apagadas e
quantas pagas continuam, e avisa que não dá para desfazer.

## Consequências

- Saldo das contas e meses passados não mudam ao excluir; só o futuro projetado.
- Os lançamentos pagos perdem o vínculo e deixam de contar como parcela no
  "comprometido por mês" e na tabela da dívida; viram despesas comuns, editáveis e
  apagáveis na tela de lançamentos.
- Não há desfazer: recadastrar a dívida gera de novo as parcelas pagas pelas datas,
  e as antigas desvinculadas ficariam em dobro (o usuário apaga as antigas).

## Alternativas consideradas

- **Apagar tudo, inclusive o realizado.** Simples, mas muda o saldo da conta e o
  histórico de meses fechados por causa de um cadastro.
- **Arquivar (`ativo = false`) em vez de excluir.** Já é o que acontece ao quitar;
  não resolve o cadastro errado, que continuaria na lista e no histórico do plano.
- **Recusar a exclusão quando há parcela paga.** Obrigaria o usuário a apagar cada
  lançamento antes, perdendo justamente o histórico que vale guardar.

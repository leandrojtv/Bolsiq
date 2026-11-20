# finance (Bolsiq Finanças)

Módulo de finanças pessoais do Bolsiq: contas, cartões, categorias, lançamentos e
importação de extrato. Nome e navegação próprios, mesmo login. Pacote
`packages/finance`, schema `finance` no banco. Decisões em
[ADR 0031](../adr/0031-bolsiq-financas.md) e
[ADR 0032](../adr/0032-importacao-ofx-financas.md) (importação OFX) e
[ADR 0033](../adr/0033-faturas-recorrencias-planejamento.md) (faturas, recorrências,
painel e planejamento) e
[ADR 0034](../adr/0034-parcelamentos-dividas-fluxo-metas.md) (parcelamentos, dívidas,
orçamento, fluxo e metas).

Não lê nem faz join com `portfolio`, `app`, `analytics` ou `market_data`. O Painel
geral (`/painel`) vai compor os módulos pelo BFF, nunca por SQL entre schemas.

## Estado atual

| Parte                                                                        | Estado                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------- |
| Contas, categorias e lançamentos (CRUD)                                      | pronto, BFF em `/api/financas/*` com OpenAPI   |
| Transferência entre contas (par de lançamentos)                              | pronto; não conta como receita nem despesa     |
| Categorias padrão semeadas no primeiro acesso                                | pronto, idempotente                            |
| Schema com RLS forçada e FKs compostas pelo dono                             | pronto, testes contra Postgres real            |
| Telas `/financas`, `/contas`, `/lancamentos`, `/categorias`                  | prontas, com lançamento rápido (Enter salva)   |
| Seletor de módulo e entrada pelo último módulo usado                         | pronto (cookie `bolsiq_modulo`)                |
| `/painel`                                                                    | só a rota, com estado vazio                    |
| Cartões e faturas pelo ciclo (`/financas/cartoes`)                           | pronto (cadastro, fatura atual, pagamento)     |
| Importação de extrato e fatura em OFX (`/financas/importar`)                 | pronto: revisão, dedupe, conciliação, desfazer |
| Regras de categorização (`/financas/regras`)                                 | pronto; correções viram regras aprendidas      |
| Fatura: fechamento, pagamento previsto e pagar (transferência)               | pronto                                         |
| Recorrências (`/financas/recorrentes`) e job diário                          | pronto; previstos até 90 dias, idempotente     |
| Dashboard do mês (`/financas`, com seletor de mês)                           | pronto                                         |
| Planejamento mensal por categoria (`/financas/planejamento`)                 | pronto; não cria lançamento                    |
| Compra parcelada no cartão e parcela importada (`/financas/parcelamentos`)   | pronto                                         |
| Empréstimo e financiamento Price/SAC com simulador (`/financas/dividas`)     | pronto                                         |
| Orçamento por categoria com estados (no planejamento; `/financas/orcamento`) | pronto                                         |
| Fluxo de caixa projetado de 3 a 12 meses (`/financas/fluxo`)                 | pronto                                         |
| Metas (`/financas/metas`)                                                    | pronto                                         |
| Importação de CSV, PDF e imagem; sugestão por IA                             | próximas etapas (novo leitor, mesma revisão)   |

## Modelo de dados

| Tabela                 | Chave                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| `accounts`             | `id`, único por `(user_id, nome)` e `(user_id, id)`                 |
| `categories`           | `id`, único por `(user_id, parent_id, nome)` (`NULLS NOT DISTINCT`) |
| `transactions`         | `id`; únicos parciais `(user_id, hash_dedupe)` e FITID por destino  |
| `cards`                | `id`, único por `(user_id, nome)` e `(user_id, id)`                 |
| `statements`           | `id`, único por `(user_id, card_id, vencimento)`                    |
| `imports`              | `id`; status `revisao`, `confirmada`, `cancelada`, `desfeita`       |
| `import_rows`          | `id`; cai junto com a importação                                    |
| `categorization_rules` | `id`, único por `(user_id, modo, padrao)`                           |
| `audit_log`            | `id`, append-only                                                   |
| `outbox`               | `id`; eventos `finance.*` (publicador entra com o primeiro)         |

- Valores em `numeric(18,2)`, sempre positivos; o sinal sai do `tipo` e, na
  transferência, de `transferencia_sentido` (`saida` ou `entrada`).
- `competencia` é o primeiro dia do mês do lançamento (check no banco).
- O saldo inicial vale no **início** de `data_saldo_inicial`. Saldo atual conta
  só `realizado` e `conciliado`; `previsto` entra no saldo previsto.
- `user_id` repetido em toda tabela para a política de RLS não precisar de
  subconsulta, e nas FKs: a checagem de FK ignora a RLS, e a chave composta
  impede apontar para a conta ou a categoria de outro usuário.
- Categorias `sistema` (Tarifas bancárias, Juros e encargos, IOF) não se apagam
  nem trocam de natureza.
- Lançamento pertence a uma conta **ou** a um cartão; o de cartão leva a fatura
  (`statement_id`). Compra até o dia do fechamento (inclusive) entra na fatura do ciclo; depois, na seguinte.
  Pagamento de fatura é transferência da conta para o cartão, nunca despesa: o gasto
  conta na compra. Fatura fechada gera o pagamento previsto na conta pagadora, no
  vencimento.

Exportação e exclusão da conta (LGPD, `/configuracoes/conta`) incluem contas,
cartões, faturas, categorias, lançamentos, importações (com as linhas), regras e
auditoria do módulo; a exclusão também apaga do outbox os eventos do usuário.

## Recorrências, painel e planejamento

- **Recorrências**: mensal (dia do mês; 31 vira o último dia), semanal (1 = segunda
  a 7 = domingo) ou anual (no mês do início). O job `finance.rotina-diaria` no
  `portfolio-worker` (cron `FINANCE_ROTINA_CRON`, padrão 03h10, e uma vez ao subir)
  gera os previstos até 90 dias e fecha as faturas. Editar muda só os previstos
  futuros; valor variável usa o último realizado.
- **Painel** (`/api/financas/painel?mes=YYYY-MM`): renda prevista x recebida,
  despesas pagas x a pagar, saldo previsto do fim do mês, fixos x variáveis (pelo
  `tipo_custo` da categoria) e em % da renda, saldo por conta, faturas não pagas,
  top 5 categorias e o que vence em 7 dias.
- **Planejamento**: itens por mês e categoria (descrição, valor, fixo). Compara com o
  realizado e o previsto da categoria, mostra a sobra planejada, copia o mês anterior
  e puxa as recorrências. Não cria lançamento.

## Parcelamentos, dívidas, orçamento, fluxo e metas

- **Compra parcelada**: uma parcela em cada fatura pelo ciclo; a fatura fechada
  realiza o que estava previsto nela. Importar a fatura com "PARC 02/10" concilia com
  a parcela prevista; sem plano, cria o plano e gera as restantes.
- **Dívidas**: Price ou SAC, tabela com juros, amortização e saldo; saldo devedor
  derivado do histórico. Simular amortização extra (reduzir prazo ou parcela, com os
  juros economizados), registrar, quitar.
- **Orçamento**: o planejamento por categoria com estados ok, atenção (≥ 80%) e
  estourado (> 100%) sobre realizado + previsto, edição inline e sugestão pela média
  de 3 meses.
- **Fluxo projetado** (`/api/financas/fluxo?meses=6`): saldo de hoje, previstos nas
  contas, faturas futuras no vencimento e recorrências além de 90 dias; primeiro mês
  negativo.
- **Metas**: por conta, carteira (o web compõe o patrimônio pelo módulo portfolio) ou
  valor guardado; valor mensal necessário até a data.

## Importação OFX

1. **Envio** (`POST /importacoes/analise`): lê os arquivos sem gravar e sugere o
   destino: importação anterior da mesma conta externa, banco do `BANKID`/`ORG`
   contra a instituição cadastrada, final do cartão no `ACCTID`, ou a única conta
   ou cartão. Para cartão, sugere a fatura que fecha depois da última compra.
2. **Revisão** (`POST /importacoes`): grava `imports` e `import_rows`. Cada linha
   chega `nova`, `ja_importada` (FITID ou hash; desmarcada) ou
   `possivel_duplicata` (lançamento manual parecido; ação `conciliar`). Categoria
   por regra do usuário, regra aprendida e histórico, nessa ordem. Na tela: marcar
   ou não, categoria (com "aplicar às iguais" e "criar regra"), transferência
   (pagamento de fatura, transferência própria) e divisão em duas categorias. O
   resumo mostra linhas, total, duplicadas e sem categoria, e o LEDGERBAL contra o
   saldo da conta.
3. **Confirmação**: grava tudo numa transação e põe
   `finance.importacao.confirmada.v1` no outbox (sem publicador até haver
   consumidor).
4. **Desfazer**: apaga os lançamentos da importação e solta as conciliações, se
   nenhum lançamento estiver `conciliado`.

Normalização de descrição: maiúsculas, sem acento, sem prefixo de adquirente
(`PAG*`, `MP *`, `IFD*`, `PG *`, `EBANX*`...), sem parcela, sem número de
autorização e sem cidade/UF no fim. Parcela (`PARC 03/10`, `3 DE 10`, `03/10` no
fim) fica em `parcela_atual`/`parcela_total` da linha.

Limites: `FINANCE_IMPORT_MAX_MB` (5), `FINANCE_IMPORT_MAX_ROWS` (5000) e
`FINANCE_IMPORT_MAX_FILES` (10).

Formato novo: um `LeitorDeExtrato` em `packages/finance/src/importacao` e uma
entrada em `LEITORES`, com fixtures. A revisão não muda.

As migrations são aplicadas pelo passo de migrate do `portfolio-worker`, journal
`drizzle_finance`.

## BFF

Todas as rotas exigem a sessão (401 sem ela) e validam com Zod (422). O
documento OpenAPI sai dos mesmos schemas em `/api/financas/openapi`, e
`apps/web/lib/financas-bff.test.ts` reprova rota sem entrada nele.

| Rota                                            | Métodos               |
| ----------------------------------------------- | --------------------- |
| `/api/financas/contas`                          | GET, POST             |
| `/api/financas/contas/{id}`                     | PATCH, DELETE         |
| `/api/financas/categorias`                      | GET, POST             |
| `/api/financas/categorias/{id}`                 | PATCH, DELETE         |
| `/api/financas/lancamentos`                     | GET (paginado), POST  |
| `/api/financas/lancamentos/{id}`                | PATCH, DELETE         |
| `/api/financas/resumo?mes=YYYY-MM`              | GET                   |
| `/api/financas/cartoes`                         | GET, POST             |
| `/api/financas/cartoes/{id}`                    | PATCH, DELETE         |
| `/api/financas/cartoes/{id}/faturas`            | GET                   |
| `/api/financas/importacoes/analise`             | POST (multipart)      |
| `/api/financas/importacoes`                     | GET, POST (multipart) |
| `/api/financas/importacoes/{id}`                | GET                   |
| `/api/financas/importacoes/{id}/linhas/{linha}` | PATCH                 |
| `/api/financas/importacoes/{id}/confirmar`      | POST                  |
| `/api/financas/importacoes/{id}/cancelar`       | POST                  |
| `/api/financas/importacoes/{id}/desfazer`       | POST                  |
| `/api/financas/regras`                          | GET, POST             |
| `/api/financas/regras/{id}`                     | PATCH, DELETE         |
| `/api/financas/openapi`                         | GET                   |

Filtros da listagem: `de`, `ate`, `conta`, `cartao`, `fatura`, `importacao`,
`categoria`, `status`, `q` (texto, com e sem acento), `pagina`, `por_pagina` (até
200). Conta com lançamento não se
apaga (409): arquive.

## Testes

- `packages/finance`: unitários de saldo, totais do mês e transferência
  (`make test`) e integração com Testcontainers provando a RLS
  (`make test-integration`).
- `packages/finance/src/importacao`: parser com as fixtures de cada banco (SGML e
  XML), normalização, parcela e regras.
- `packages/finance/src/integration/importacao.test.ts`: confirmação numa
  transação com evento no outbox, mesmo arquivo duas vezes (zero linhas),
  período sobreposto com FITID trocado, conciliação, regras aprendidas, desfazer
  e RLS das tabelas novas.
- `apps/web/e2e/financas.spec.ts`: criar conta, lançar despesa, ver na lista e
  voltar para Finanças depois do login.
- `packages/finance/src/integration/recorrencias.test.ts`: fatura fecha e gera o
  previsto uma vez, pagar não dobra a despesa, rotina diária duas vezes não duplica,
  edição de recorrência só nos futuros, valor variável e planejamento.
- `packages/finance/src/emprestimo.test.ts`: Price e SAC contra tabelas de
  referência calculadas à parte, simulador e saldo devedor pelo histórico.
- `packages/finance/src/integration/parcelamentos.test.ts`: compra 3x nas 3
  faturas, parcela importada concilia, parcela sem plano cria o plano, dívida com
  amortização e quitação, fluxo com recorrência, parcela e fatura, orçamento e metas.
- `apps/web/e2e/financas-parcelamento.spec.ts`: compra em 3x aparece nas 3 faturas.
- `apps/web/e2e/financas-cartao.spec.ts`: criar cartão, comprar, ver na fatura,
  pagar e conferir no painel que a despesa não dobrou.
- `apps/web/e2e/financas-importacao.spec.ts`: importar um OFX de fixture, revisar,
  confirmar, reimportar sem duplicar e desfazer.

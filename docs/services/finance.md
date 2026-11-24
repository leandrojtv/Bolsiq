# finance (Bolsiq Finanças)

Módulo de finanças pessoais do Bolsiq: contas, cartões, categorias, lançamentos e
importação de extrato. Nome e navegação próprios, mesmo login. Pacote
`packages/finance`, schema `finance` no banco. Decisões em
[ADR 0031](../adr/0031-bolsiq-financas.md) e
[ADR 0032](../adr/0032-importacao-ofx-financas.md) (importação OFX) e
[ADR 0033](../adr/0033-faturas-recorrencias-planejamento.md) (faturas, recorrências,
painel e planejamento) e
[ADR 0034](../adr/0034-parcelamentos-dividas-fluxo-metas.md) (parcelamentos, dívidas,
orçamento, fluxo e metas) e
[ADR 0035](../adr/0035-insights-financas.md) (insights de gastos) e
[ADR 0038](../adr/0038-importacao-csv-c6.md) (fatura do C6 em CSV) e
[ADR 0039](../adr/0039-excluir-divida.md) (excluir empréstimo ou financiamento).

Não lê nem faz join com `portfolio`, `app`, `analytics` ou `market_data`. O Painel
geral (`/painel`) vai compor os módulos pelo BFF, nunca por SQL entre schemas.

## Estado atual

| Parte                                                                        | Estado                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Contas, categorias e lançamentos (CRUD)                                      | pronto, BFF em `/api/financas/*` com OpenAPI    |
| Transferência entre contas (par de lançamentos)                              | pronto; não conta como receita nem despesa      |
| Categorias padrão semeadas no primeiro acesso                                | pronto, idempotente                             |
| Schema com RLS forçada e FKs compostas pelo dono                             | pronto, testes contra Postgres real             |
| Telas `/financas`, `/contas`, `/lancamentos`, `/categorias`                  | prontas, com lançamento rápido (Enter salva)    |
| Seletor de módulo e entrada pelo último módulo usado                         | pronto (cookie `bolsiq_modulo`)                 |
| `/painel`                                                                    | só a rota, com estado vazio                     |
| Cartões e faturas pelo ciclo (`/financas/cartoes`)                           | pronto (cadastro, fatura atual, pagamento)      |
| Importação de extrato e fatura em OFX (`/financas/importar`)                 | pronto: revisão, dedupe, conciliação, desfazer  |
| Fatura do C6 em CSV (`/financas/importar`)                                   | pronto: parcelas, pagamento, IOF, vários finais |
| Regras de categorização (`/financas/regras`)                                 | pronto; correções viram regras aprendidas       |
| Fatura: fechamento, pagamento previsto e pagar (transferência)               | pronto                                          |
| Recorrências (`/financas/recorrentes`) e job diário                          | pronto; previstos até 90 dias, idempotente      |
| Dashboard do mês (`/financas`, com seletor de mês)                           | pronto                                          |
| Planejamento mensal por categoria (`/financas/planejamento`)                 | pronto; não cria lançamento                     |
| Compra parcelada no cartão e parcela importada (`/financas/parcelamentos`)   | pronto                                          |
| Empréstimo e financiamento Price/SAC com simulador (`/financas/dividas`)     | pronto; exclusão com confirmação                |
| Orçamento por categoria com estados (no planejamento; `/financas/orcamento`) | pronto                                          |
| Fluxo de caixa projetado de 3 a 12 meses (`/financas/fluxo`)                 | pronto                                          |
| Metas (`/financas/metas`)                                                    | pronto                                          |
| Insights (`/financas/insights`) e "Onde otimizar" no dashboard               | pronto; determinísticos, com evidências         |
| Assinaturas detectadas (`/financas/assinaturas`)                             | pronto                                          |
| Simulador de cortes (`/financas/insights/simulador`)                         | pronto                                          |
| Importação de CSV de outros bancos, PDF e imagem; sugestão por IA            | próximas etapas (novo leitor, mesma revisão)    |

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
| `insights`             | `id`, único por `(user_id, periodo)`; cache da lista do mês         |
| `insight_feedback`     | `id`, único por `(user_id, insight_id)`                             |
| `insight_settings`     | `user_id`; limite do efeito formiga e referência 50/30/20           |

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
cartões, faturas, categorias, lançamentos, importações (com as linhas), regras,
insights (cache, respostas e ajustes) e auditoria do módulo; a exclusão também apaga do outbox os eventos do usuário.

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
- **Item dividido**: uma despesa com custo dividido (aluguel, condomínio) guarda o
  valor fechado em `valor` e o percentual do usuário em `parte_propria` (entre 0 e
  100, exclusivos; nulo quando não é dividido). Planejado da categoria, fixos, sobra,
  painel e alertas usam só a parte própria (`valor_proprio`); o total coberto por
  outros sai em `totais.despesas_de_terceiros`. Copiar o mês leva a divisão junto.

## Parcelamentos, dívidas, orçamento, fluxo e metas

- **Compra parcelada**: uma parcela em cada fatura pelo ciclo; a fatura fechada
  realiza o que estava previsto nela. Importar a fatura com "PARC 02/10" concilia com
  a parcela prevista; sem plano, cria o plano e gera as restantes. As parcelas
  anteriores à importada (1 a 5 de uma 6/7) não viram lançamento, mas contam como
  pagas no resumo do plano.
- **Dívidas**: Price ou SAC, tabela com juros, amortização e saldo; saldo devedor
  derivado do histórico. Simular amortização extra (reduzir prazo ou parcela, com os
  juros economizados), registrar, quitar.
- **Excluir dívida** (`DELETE /api/financas/dividas/{id}`, botão "Excluir dívida" no
  detalhe, com confirmação): apaga as parcelas previstas e mantém os lançamentos
  realizados (parcelas pagas e amortizações extras) na conta, sem o vínculo com o
  plano (`installment_plan_id` e `parcela_numero` nulos). Saldo da conta e meses
  passados não mudam. Responde `previstas_apagadas` e `realizados_desvinculados`;
  compra parcelada no cartão dá 422 (sai por `DELETE /api/financas/parcelamentos/{id}`,
  mesma regra); plano de outro usuário dá 404. Sem desfazer.
- **Orçamento**: o planejamento por categoria com estados ok, atenção (≥ 80%) e
  estourado (> 100%) sobre realizado + previsto, edição inline e sugestão pela média
  de 3 meses.
- **Fluxo projetado** (`/api/financas/fluxo?meses=6`): saldo de hoje, previstos nas
  contas, faturas futuras no vencimento e recorrências além de 90 dias; primeiro mês
  negativo.
- **Metas**: por conta, carteira (o web compõe o patrimônio pelo módulo portfolio) ou
  valor guardado; valor mensal necessário até a data.

## Insights

Detectores puros em `packages/finance/src/insights` (regras no
[ADR 0035](../adr/0035-insights-financas.md)): ranking, assinaturas (reajuste,
possível duplicidade, nova), tarifas e juros, efeito formiga, fora do padrão,
essencial x supérfluo, custo de oportunidade ao CDI e simulador de cortes. Cada
insight traz `evidencias` (ids dos lançamentos) e sai ordenado por impacto anual.

- **Cache** por usuário e mês em `finance.insights`; a leitura recalcula quando a
  marca dos dados muda (dia, quantidade ou última mudança dos lançamentos).
- **Job** `finance.insights` no `portfolio-worker`: por usuário, enfileirado pelo BFF
  ao confirmar uma importação; de todos, pelo cron `FINANCE_INSIGHTS_CRON` (padrão
  03h40).
- **Evento** `finance.insight.novo.v1` no outbox (assinatura nova, reajuste, tarifa
  nova), uma vez por fato; payload com `user_id`, `insight_id`, `motivo`, `chave`,
  `titulo`, `descricao`, impactos e `periodo`.
- **Respostas**: dispensado e "ainda uso" somem por 90 dias (voltam se o impacto
  anual subir mais de 20%); "já cancelei" some até nova cobrança; "vou cancelar"
  fica visível. "Transformar em recorrente" cria a recorrência a partir da próxima
  cobrança.
- **CDI** do `/v1/macro/cdi` (BCB SGS 12), buscado pelo web; a tela mostra a
  premissa, a data e a fonte.

## Painel geral e alertas

Decisões no [ADR 0037](../adr/0037-painel-geral-e-alertas-financeiros.md).

- **Patrimônio** (`patrimonio.ts`, puro): `comporPatrimonio` soma contas e carteiras e
  subtrai faturas em aberto e o saldo devedor de empréstimos e financiamentos.
  `partesDoFinance` dá a parte do finance; a das carteiras vem do `portfolio`
  (`patrimonioDasCarteiras`), e o BFF junta em `GET /api/financas/painel-geral`.
- **Foto mensal** em `net_worth_snapshots` (usuário, mês), pelo job
  `finance.patrimonio_mensal` do `portfolio-worker` no dia 1; idempotente, com os
  números do portfolio guardados como valor.
- **Vigia** (`vigia.ts`, regras puras; `db/vigia.ts`): fatura vencendo em 3 dias,
  orçamento da categoria em 80% e 100%, mês projetado negativo e receita prevista
  atrasada. Cada fato tem uma `chave`; `emitted_alerts` impede publicar duas vezes.
  Job `finance.vigia` de hora em hora e depois de lançamento ou importação.
- **Outbox publicado** no stream `FINANCE` pelo `portfolio-worker`, com dead-letter em
  `finance.dead_letter`; o `alerts-worker` transforma em aviso.
  Runbook: [painel-e-alertas-financeiros](../runbooks/painel-e-alertas-financeiros.md).

## Assistente

O "Pergunte ao Bolsiq" aberto em `/financas` usa as ferramentas do Bolsiq Finanças
(`packages/assistant/src/financas`), que leem deste pacote pela RLS do usuário
(`fontesFinanceirasDoBanco`): resumo do mês, gastos por categoria, comparação de meses,
busca de lançamentos, fluxo, parcelas, assinaturas, insights, cortes, compra parcelada e
capacidade de aporte. O relatório mensal opt-in sai do `portfolio-worker` no dia 1.
Decisões no [ADR 0036](../adr/0036-agente-financeiro.md).

## Importação OFX e CSV

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

Pagamento de fatura num cartão (crédito com descrição de pagamento) nunca vira
receita: concilia com a transferência já lançada; senão, vira transferência da
conta que paga o cartão (ou da única conta do mesmo banco); senão, chega
desmarcado, e confirmar com ele marcado e sem conta é recusado.

## Fatura do C6 em CSV

O C6 só exporta a fatura em CSV (`Fatura_AAAA-MM-DD.csv`, separador `;`). O
leitor `csv-c6` reconhece o arquivo pelo cabeçalho ([ADR 0038](../adr/0038-importacao-csv-c6.md)):

- vencimento sugerido pelo nome do arquivo, no dia de vencimento do cartão;
- cartão sugerido por qualquer um dos finais (principal, adicional, virtual);
  tudo entra na fatura escolhida, e a análise avisa quantos finais há;
- parcela `n/N` da coluna `Parcela`, com a data da compra levada para o mês da
  parcela (a anuidade, que já vem com a data do mês, fica como está); cria ou
  concilia o plano como a parcela do OFX;
- `Inclusao de Pagamento` (negativo) é o pagamento da fatura (regra acima);
- IOF de compra internacional (linha em reais com o mesmo nome e data de uma
  compra em dólar) ganha o prefixo `IOF` e a categoria IOF;
- categoria do banco mapeada para a padrão (`origem_categoria = "banco"`) quando
  nenhuma regra nem o histórico casam; anuidade vai para Tarifas bancárias.

O arquivo não traz o total da fatura: a revisão mostra compras e créditos para
conferir com o app do banco.

As migrations são aplicadas pelo passo de migrate do `portfolio-worker`, journal
`drizzle_finance`.

## BFF

Todas as rotas exigem a sessão (401 sem ela) e validam com Zod (422). O
documento OpenAPI sai dos mesmos schemas em `/api/financas/openapi`, e
`apps/web/lib/financas-bff.test.ts` reprova rota sem entrada nele.

| Rota                                            | Métodos                 |
| ----------------------------------------------- | ----------------------- |
| `/api/financas/contas`                          | GET, POST               |
| `/api/financas/contas/{id}`                     | PATCH, DELETE           |
| `/api/financas/categorias`                      | GET, POST               |
| `/api/financas/categorias/{id}`                 | PATCH, DELETE           |
| `/api/financas/lancamentos`                     | GET (paginado), POST    |
| `/api/financas/lancamentos/{id}`                | PATCH, DELETE           |
| `/api/financas/resumo?mes=YYYY-MM`              | GET                     |
| `/api/financas/cartoes`                         | GET, POST               |
| `/api/financas/cartoes/{id}`                    | PATCH, DELETE           |
| `/api/financas/cartoes/{id}/faturas`            | GET                     |
| `/api/financas/importacoes/analise`             | POST (multipart)        |
| `/api/financas/importacoes`                     | GET, POST (multipart)   |
| `/api/financas/importacoes/{id}`                | GET                     |
| `/api/financas/importacoes/{id}/linhas/{linha}` | PATCH                   |
| `/api/financas/importacoes/{id}/confirmar`      | POST                    |
| `/api/financas/importacoes/{id}/cancelar`       | POST                    |
| `/api/financas/importacoes/{id}/desfazer`       | POST                    |
| `/api/financas/regras`                          | GET, POST               |
| `/api/financas/regras/{id}`                     | PATCH, DELETE           |
| `/api/financas/parcelamentos`                   | GET, POST               |
| `/api/financas/parcelamentos/{id}`              | GET, DELETE             |
| `/api/financas/parcelamentos/{id}/quitar`       | POST                    |
| `/api/financas/dividas`                         | POST                    |
| `/api/financas/dividas/{id}`                    | DELETE                  |
| `/api/financas/dividas/{id}/simular`            | POST                    |
| `/api/financas/dividas/{id}/amortizar`          | POST                    |
| `/api/financas/insights?mes=YYYY-MM`            | GET                     |
| `/api/financas/insights/{id}?mes=YYYY-MM`       | GET (com as evidências) |
| `/api/financas/insights/{id}/feedback`          | POST                    |
| `/api/financas/insights/configuracao`           | GET, PUT                |
| `/api/financas/insights/simulador`              | GET (base do simulador) |
| `/api/financas/assinaturas`                     | GET                     |
| `/api/financas/assinaturas/{id}/recorrente`     | POST                    |
| `/api/financas/openapi`                         | GET                     |

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
  amortização e quitação, excluir dívida (previstas apagadas, pagas e amortização
  extra mantidas sem vínculo, 404 para outro usuário, 422 para compra no cartão),
  fluxo com recorrência, parcela e fatura, orçamento e metas.
- `apps/web/e2e/financas-parcelamento.spec.ts`: compra em 3x aparece nas 3 faturas.
- `apps/web/e2e/financas-dividas.spec.ts`: cadastrar financiamento com 3 parcelas
  pagas, cancelar e confirmar a exclusão, em desktop e em celular (390 px), e conferir
  que só as 3 pagas ficam nos lançamentos.
- `packages/finance/src/insights/*.test.ts`: cada detector com casos positivos e
  negativos (conta de luz variável não é assinatura; dois cafés no mesmo dia não são
  assinatura nem duplicidade), dispensa de 90 dias, simulador e custo de oportunidade.
- `packages/finance/src/integration/insights.test.ts`: job recalcula e publica cada
  novidade uma vez, evidências, dispensa, recálculo ao lançar e apagar, ajustes,
  recorrente, simulador e RLS das tabelas novas.
- `apps/web/e2e/financas-insights.spec.ts`: lançar uma tarifa, ver em "Onde otimizar",
  abrir o insight com as evidências e dispensar.
- `apps/web/e2e/financas-cartao.spec.ts`: criar cartão, comprar, ver na fatura,
  pagar e conferir no painel que a despesa não dobrou.
- `apps/web/e2e/financas-importacao.spec.ts`: importar um OFX de fixture, revisar,
  confirmar, reimportar sem duplicar e desfazer.
- `packages/finance/src/importacao/csv-c6.test.ts`: fatura do C6 anonimizada
  (`fixtures/c6-Fatura_2026-11-10.csv`) com totais, pagamento, parcelas, IOF,
  categoria do banco e casos de borda.
- `packages/finance/src/integration/importacao.test.ts` (fatura do C6): sugestão
  pelo final e pelo nome, pagamento desmarcado sem conta, transferência da conta
  do C6, conciliação com o pagamento lançado, 20 planos criados, totais da fatura,
  reimportação e parcela seguinte conciliando com o plano.
- `apps/web/e2e/financas-importacao-c6.spec.ts`: upload da fatura do C6, compras e
  créditos batendo com o arquivo, pagamento como transferência e confirmação.

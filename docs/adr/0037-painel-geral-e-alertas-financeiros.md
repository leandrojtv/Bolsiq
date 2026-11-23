# ADR 0037 - Painel geral (patrimônio consolidado) e alertas financeiros

- **Status:** aceito
- **Data:** 2026-11-20
- **Decisores:** @leandrojtv

Usa o BFF do [ADR 0020](0020-bff-do-web.md), o worker e o sino dos
[ADR 0012](0012-alerts-worker.md) e [ADR 0021](0021-identidade-provisoria-e-sino.md), o
outbox do [ADR 0008](0008-outbox-e-jetstream.md) e a capacidade de aporte do
[ADR 0036](0036-agente-financeiro.md).

## Contexto

O `/painel` era um estado vazio. O usuário quer ver o patrimônio somado entre
Investimentos e Finanças, o mês e quanto pode aportar, e quer ser avisado sobre fatura
vencendo, orçamento estourado, saldo projetado negativo, assinatura nova e salário que
não caiu. Os dados estão em dois schemas (`portfolio` e `finance`) que não se juntam, e
o outbox do finance (`finance.insight.novo.v1`, ADR 0035) era gravado mas nunca
publicado.

## Decisão

### Patrimônio

**Patrimônio líquido = contas + carteiras - faturas em aberto - saldo devedor de
empréstimos e financiamentos.**

- **Contas:** saldo atual das contas não arquivadas. Cheque especial entra negativo.
- **Carteiras:** o ticker vale pela cotação e entra em renda variável. O extrato vale
  pelo saldo bruto da carga vigente, no grupo da classe:
  - renda fixa: renda fixa, título público, COE, estruturado;
  - fundos: fundo, previdência;
  - renda variável: cripto e outro.
- **Faturas:** compras realizadas menos estornos e pagamentos, nas faturas não pagas.
  - Parcela futura é prevista e ainda não é dívida.
  - Parcelado no cartão não entra nas dívidas: já está na fatura.

Cada módulo dá a sua parte, pela RLS do usuário, e ninguém junta os schemas:

| Parte                     | Quem calcula                                         |
| ------------------------- | ---------------------------------------------------- |
| contas, faturas e dívidas | `finance` (`partesDoFinance`)                        |
| carteiras por grupo       | `portfolio` (`patrimonioDasCarteiras`)               |
| soma e composição         | `finance/puro` (`comporPatrimonio`), função pura     |
| capacidade de aporte      | `assistant` (`capacidadeDoUsuario`), sem chamar a IA |

O BFF (`GET /api/financas/painel-geral`) avalia as carteiras pela cotação ao vivo do
`/v1`. O job mensal usa o fechamento do último pregão do mês, pelo `/v1/history`. As
duas pontas chamam as mesmas funções.

### Foto mensal

`finance.net_worth_snapshots`, chave (usuário, mês), gravada pelo job
`finance.patrimonio_mensal` do `portfolio-worker` no dia 1 (`NET_WORTH_SNAPSHOT_CRON`,
padrão 06h30). Um job por usuário, com `singletonKey`.

- **Por valor.** Os números do portfolio ficam na foto como valor (total por grupo e
  valor de cada carteira), não como referência: mudar a carteira depois não reescreve
  a história.
- **Idempotente.** `insert ... on conflict do nothing`: a primeira foto do mês vale, e
  repetir o job não muda nada.
- **Mês corrente.** O painel acrescenta o mês corrente ao vivo, marcado como parcial.

### Alertas financeiros

**Os fatos vêm do finance, a decisão é do alerts.** O job `finance.vigia` roda de hora
em hora (`FINANCE_VIGIA_CRON`) e, por usuário, depois de lançamento ou importação. Ele
aplica regras puras (`finance/src/vigia.ts`) e grava no outbox:

| Evento                        | Regra                                                           |
| ----------------------------- | --------------------------------------------------------------- |
| `finance.fatura.vencendo.v1`  | fatura não paga, com valor a pagar, vence em até 3 dias         |
| `finance.orcamento.limite.v1` | consumo da categoria em 80% e em 100% (pulou direto: só o 100%) |
| `finance.saldo.negativo.v1`   | primeiro dos 3 meses projetados com saldo final negativo        |
| `finance.receita.atrasada.v1` | receita prevista com a data passada (até 31 dias)               |
| `finance.insight.novo.v1`     | já existia: assinatura nova, reajuste e tarifa nova             |

**Cada fato é avisado uma vez.** Cada fato tem uma `chave` estável (fatura, mês e
categoria com o limiar, mês projetado, lançamento com a data).
`finance.emitted_alerts` guarda a chave na mesma transação do outbox. O outbox é fila
e é limpo, por isso não serve para isso. No alerts, a notificação é única por
(`financas:<tipo>`, `<usuário>:<chave>`).

**O outbox do finance passa a ser publicado.** O `portfolio-worker` publica no stream
`FINANCE` (`finance.>`), com o publicador de sempre e dead-letter em
`finance.dead_letter`. A migration marca como publicado o que estava parado: é
história, não alerta atrasado.

**No alerts não há regra criada pelo usuário.** O `alerts-worker` assina o `FINANCE`
(consumidor `alerts-finance`, filtro `finance.>`), traduz o evento em aviso
(`financas-modelo.ts`) e aplica a preferência do tipo. A preferência fica em
`alerts.user_prefs.financas` e vale `{ ativo, canais }` por tipo:

- o padrão é ligado, só no sino;
- os canais externos seguem os canais ligados e a janela de silêncio;
- a tela é `/configuracoes/notificacoes`.

O aviso leva o `link` da tela certa em `dados`.

## Consequências

- O painel mostra cotação ao vivo; a evolução usa o fechamento do mês. No dia 1 os dois
  podem diferir um pouco, e o texto da tela diz isso.
- Até uma hora de atraso no alerta de orçamento quando o gasto vem só de recorrência ou
  previsto. Lançamento e importação disparam o vigia na hora.
- As regras têm limiar fixo (3 dias, 80% e 100%, 3 meses, 31 dias). Ficam no código,
  testadas uma a uma.
- Um evento a mais por fato no NATS e uma linha por fato em `emitted_alerts`, que cresce
  devagar (fatos, não lançamentos).
- O `portfolio-worker` passa a depender do NATS.
- Os streams reservam disco no JetStream, e o `max_file_store` do `nats.conf` é 16 GB,
  que `MARKETDATA` e `ANALYTICS` já ocupavam (8 GB cada). `ANALYTICS` desce para 1 GB:
  usa poucos MB, porque indicador muda por trimestre. `FINANCE` fica com 1 GB e 1 milhão
  de mensagens.

## Alternativas consideradas

- **SQL entre `finance` e `portfolio`.** Fere a regra de dono dos dados. Quando os
  módulos virarem serviços, o painel muda só a chamada.
- **Foto do patrimônio guardando o id da carteira.** Recalcular o passado com a carteira
  de hoje mudaria a história a cada edição.
- **Alertas financeiros como regras em `alert_rules`.** Exigiria criar sete regras por
  usuário e um índice por usuário, sem ganho: o fato já é do usuário.
- **Avaliar orçamento a cada lançamento, no BFF.** Espalharia regra de alerta por todos
  os caminhos de escrita; o vigia centraliza e o BFF só o acorda.

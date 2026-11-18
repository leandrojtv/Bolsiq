# ADR 0029 - Recuperar jobs agendados perdidos ao subir o worker

- **Status:** aceito
- **Data:** 2026-11-17
- **Decisores:** @leandrojtv

## Contexto

O cron do pg-boss só dispara no horário. Se o worker estiver fora do ar nesse
momento, a execução se perde, e o dado fica parado até o horário seguinte do
mesmo cron. No ambiente local isso é o caso comum: o Docker fica desligado à
noite ou no fim de semana. Em 17/11/2026 o ambiente subiu depois de três dias
desligado e `quotes_daily` continuava em 12/11; DFP e ITR, semanais, só
voltariam na segunda seguinte (#48).

Dois detalhes do pg-boss pesam na solução:

- o histórico de execuções (`pgboss.job` e `pgboss.archive`) é apagado depois
  de 7 dias, então um job semanal pode não ter execução nenhuma registrada;
- `boss.schedule()` em cada subida preserva `pgboss.schedule.created_on`.

## Decisão

Ao subir, depois de registrar filas e crons, o worker chama
`recuperarJobsAtrasados` (`jobs/recuperacao.ts`). Para cada job com cron:

1. calcula o último horário previsto com `cron-parser` (o mesmo parser do
   pg-boss), no fuso `America/Sao_Paulo`;
2. se nem a última execução (qualquer estado, inclusive na fila) nem o registro
   do cron são posteriores a esse horário, enfileira o job pelo mesmo caminho
   do `POST /admin/jobs/{name}`.

O `b3-cotahist-diario` recuperado recebe a data do pregão perdido, não a de
hoje. Quando o `b3-cotahist-lacunas` também está atrasado, o diário de dia
anterior a hoje fica de fora: o lacunas já cobre esse dia, e os dois carregando
as mesmas linhas em paralelo dão deadlock no Postgres.

Não há job novo de pregão: a cotação ao vivo já é read-through na brapi com TTL
(ADR 0013), e o fechamento continua vindo do COTAHIST.

## Consequências

- Subir o Docker depois de qualquer intervalo atualiza COTAHIST, CVM e BCB sem
  intervenção; a agenda normal segue valendo depois disso.
- Banco novo (CI, e2e) não dispara nada: o cron acabou de ser registrado. A
  primeira carga continua sendo o `make backfill`.
- Subir o worker duas vezes seguidas não duplica a recuperação, porque o job
  enfileirado já conta como execução.
- Se o worker subir segundos depois de um horário, o job pode rodar duas vezes
  (recuperação e cron). As cargas comparam hash e são idempotentes, então o
  custo é só o download.
- Falha na recuperação é registrada em log e não derruba o worker.

## Alternativas consideradas

- **Rodar todos os jobs ao subir, sempre.** Simples, mas baixa CVM e B3 a cada
  reinício e dispararia downloads no CI.
- **Limite de idade por tabela (`fetched_at`).** Exigiria uma regra por fonte e
  não distingue feriado de atraso; o cron já diz quando o dado deveria ter
  chegado.

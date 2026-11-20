# Runbook: foto mensal do patrimônio e vigia do Finanças

Jobs do `portfolio-worker` do [ADR 0037](../adr/0037-painel-geral-e-alertas-financeiros.md):

| Job                                | Quando                                         | O que faz                                               |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `finance.patrimonio_mensal.rotina` | `NET_WORTH_SNAPSHOT_CRON` (dia 1, 06h30 SP)    | enfileira um `finance.patrimonio_mensal` por usuário    |
| `finance.patrimonio_mensal`        | pela rotina                                    | grava a foto do mês anterior em `net_worth_snapshots`   |
| `finance.vigia`                    | `FINANCE_VIGIA_CRON` (hora em hora) e pelo web | grava no outbox os fatos novos (fatura, orçamento, ...) |

O mesmo processo publica o outbox do finance no stream `FINANCE` do NATS. O
`alerts-worker` consome (`alerts-finance`) e grava as notificações.

## 1. Veja o estado

```bash
docker compose exec postgres psql -U bolsiq -d bolsiq -c "
  select name, state, count(*) from pgboss.job
  where name like 'finance.%' and created_on > now() - interval '2 days'
  group by 1, 2 order by 1, 2;"
```

Fotos do último mês e outbox parado:

```bash
docker compose exec postgres psql -U bolsiq -d bolsiq -c "
  select mes, count(*) from finance.net_worth_snapshots group by 1 order by 1 desc limit 3;"
docker compose exec postgres psql -U bolsiq -d bolsiq -c "
  select event_name, count(*) filter (where published_at is null and dead_at is null) as pendentes,
         count(*) filter (where dead_at is not null) as mortos
  from finance.outbox group by 1;"
```

`pendentes` subindo: o `portfolio-worker` não fala com o NATS (veja o log
`falha ao publicar o outbox do finance`). Linha morta tem o motivo em
`finance.dead_letter`.

## 2. Refazer a foto de um mês

A foto é idempotente: a primeira do mês vale e o job não sobrescreve. Para refazer
(cotação errada no fechamento, por exemplo), apague a foto e enfileire de novo:

```bash
docker compose exec postgres psql -U bolsiq -d bolsiq -c "
  delete from finance.net_worth_snapshots where user_id = '<usuario>' and mes = '2026-10-01';"
docker compose exec postgres psql -U bolsiq -d bolsiq -c "
  insert into pgboss.job (name, data)
  values ('finance.patrimonio_mensal', '{\"user_id\": \"<usuario>\", \"mes\": \"2026-10\"}');"
```

Para todos os usuários de um mês, apague as fotos do mês e enfileire a rotina (passo 3):
ela sempre fotografa o mês anterior ao dia em que roda. Para um mês mais antigo, use o
envio por usuário acima.

## 3. Rodar a rotina fora do horário

```bash
docker compose exec postgres psql -U bolsiq -d bolsiq -c "
  insert into pgboss.job (name, data) values ('finance.patrimonio_mensal.rotina', '{}');"
docker compose exec postgres psql -U bolsiq -d bolsiq -c "
  insert into pgboss.job (name, data) values ('finance.vigia', '{}');"
```

`finance.vigia` sem `user_id` olha todos os usuários com conta ou cartão; com
`{"user_id": "..."}`, um só.

## 4. Um alerta não chegou

1. O fato foi visto? `select * from finance.emitted_alerts where user_id = '<usuario>'
order by emitido_em desc limit 20;`
2. Foi publicado? Procure a chave no `finance.outbox` (`payload->>'chave'`).
3. O alerts gravou? `select * from alerts.notifications where user_id = '<usuario>' and
rule_id like 'financas:%' order by criada_em desc;`
4. O tipo está desligado? `select financas from alerts.user_prefs where user_id =
'<usuario>';`

Para avisar de novo um fato (teste, correção de regra), apague a linha de
`finance.emitted_alerts` e a notificação; o próximo vigia publica outra vez.

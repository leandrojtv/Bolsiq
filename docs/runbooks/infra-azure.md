# Runbook: infraestrutura de produção no Azure

Produção é uma VM única no Azure rodando o `compose.prod.yml` (ADR 0030).

| Item            | Valor                                                       |
| --------------- | ----------------------------------------------------------- |
| Resource group  | `rg-bolsiq` (`eastus2`)                                     |
| VM              | `vm-bolsiq`, `Standard_B2als_v2`, Ubuntu 24.04              |
| Disco           | `osdisk-bolsiq`, StandardSSD_LRS, 64 GB                     |
| IP / DNS        | `pip-bolsiq`, estático, `bolsiq.eastus2.cloudapp.azure.com` |
| NSG             | `nsg-bolsiq`: entrada só em 22, 80 e 443                    |
| Usuário SSH     | `bolsiq`, só chave (secret `SSH_KEY` do environment)        |
| Compose no host | `/home/bolsiq/bolsiq` (`compose.yml` + `.env`)              |
| Backups         | `/home/bolsiq/backups`, 7 dias                              |
| Budget          | `budget-bolsiq`, alerta em 80% e 100%                       |

Horários (Brasília, sem horário de verão):

- **23:00** auto-shutdown nativo da VM (02:00 UTC). Desaloca: computação para de
  cobrar; disco e IP continuam.
- **22:30** backup diário (cron do usuário `bolsiq`, 01:30 UTC).
- **09:00** workflow [vm-start.yml](../../.github/workflows/vm-start.yml) liga a
  VM e roda o smoke (12:00 UTC).

## Acesso

```bash
ssh -i ~/.ssh/bolsiq_deploy bolsiq@bolsiq.eastus2.cloudapp.azure.com
```

```bash
cd ~/bolsiq && docker compose ps
```

## Ligar e desligar manualmente

Pelo GitHub (liga e roda o smoke):

```bash
gh workflow run vm-start.yml
```

Pelo Azure CLI:

```bash
az vm start -g rg-bolsiq -n vm-bolsiq
```

```bash
az vm deallocate -g rg-bolsiq -n vm-bolsiq
```

Use `deallocate`, não `stop`: `stop` desliga o SO mas continua cobrando a VM.
No desligamento, o `bolsiq.service` roda `docker compose stop` antes, então o
Postgres fecha limpo. No boot, o mesmo serviço roda `docker compose up -d`.

Para trabalhar depois das 23:00, adie o desligamento da noite:

```bash
az vm auto-shutdown -g rg-bolsiq -n vm-bolsiq --time 0500
```

Volte para `0200` (UTC) no dia seguinte.

## Estado dos serviços

```bash
systemctl status bolsiq.service
```

```bash
cd ~/bolsiq && docker compose logs --tail 100 market-data-worker
```

```bash
cd ~/bolsiq && SMOKE_EXTRA_ENDPOINTS=/api/health bash smoke.sh http://localhost:8000
```

Os crons do market-data que caem entre 23:00 e 09:00 são reenfileirados quando
o worker sobe (ADR 0029). Procure `recuperacao` no log do `market-data-worker`.

## Variáveis de produção

O `.env` da VM vem do secret `ENV_FILE`, gravado igual nos environments
`production` e `production-rollback`. O GitHub não mostra o valor, então a
cópia completa é o `.env` da VM. Para mudar uma variável:

```bash
scp -i ~/.ssh/bolsiq_deploy bolsiq@bolsiq.eastus2.cloudapp.azure.com:bolsiq/.env ~/bolsiq-prod.env
```

Edite `~/bolsiq-prod.env`, grave nos dois environments e aplique na VM:

```bash
gh secret set ENV_FILE --repo leandrojtv/Bolsiq --env production < ~/bolsiq-prod.env
```

```bash
gh secret set ENV_FILE --repo leandrojtv/Bolsiq --env production-rollback < ~/bolsiq-prod.env
```

```bash
scp -i ~/.ssh/bolsiq_deploy ~/bolsiq-prod.env bolsiq@bolsiq.eastus2.cloudapp.azure.com:bolsiq/.env
```

```bash
ssh -i ~/.ssh/bolsiq_deploy bolsiq@bolsiq.eastus2.cloudapp.azure.com 'cd ~/bolsiq && docker compose up -d'
```

```bash
rm ~/bolsiq-prod.env
```

E-mail (Brevo): `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER`
e `SMTP_PASSWORD` com o login e a chave SMTP do painel do Brevo, e `SMTP_FROM`
com um remetente verificado no Brevo. Sem e-mail, ninguém confirma o cadastro.

## Carga histórica

Um banco novo não tem ativos: os crons só trazem o dia. Depois do primeiro
deploy, rode a carga uma vez. Na `B2als_v2` ela passa de meia hora; o log
fica no home e termina com `backfill concluído`:

```bash
ssh -i ~/.ssh/bolsiq_deploy bolsiq@bolsiq.eastus2.cloudapp.azure.com 'cd ~/bolsiq && nohup docker compose run --rm --no-deps -T market-data-worker node dist/backfill.js 2024 > ~/backfill.log 2>&1 < /dev/null &'
```

## Backup

O cron chama `~/bolsiq/backup-postgres.sh`, que o deploy envia a cada release
(fonte: [infra/azure/backup-postgres.sh](../../infra/azure/backup-postgres.sh)).

Rodar na hora:

```bash
bash ~/bolsiq/backup-postgres.sh
```

```bash
ls -lh ~/backups && tail ~/backups/backup.log
```

Copiar o último para a sua máquina:

```bash
scp -i ~/.ssh/bolsiq_deploy "bolsiq@bolsiq.eastus2.cloudapp.azure.com:$(ssh -i ~/.ssh/bolsiq_deploy bolsiq@bolsiq.eastus2.cloudapp.azure.com 'ls -1t ~/backups/*.dump | head -1')" .
```

Os backups ficam no mesmo disco da VM: protegem contra erro de dado, não contra
perda da VM ou do disco.

## Restaurar um backup

Derruba a aplicação, recria o banco e restaura. Os serviços ficam fora do ar
durante a restauração.

```bash
cd ~/bolsiq && docker compose stop web kong caddy market-data market-data-worker alerts-worker analytics-worker portfolio-worker
```

```bash
cd ~/bolsiq && docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

```bash
cd ~/bolsiq && docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT timescaledb_pre_restore();"'
```

```bash
cd ~/bolsiq && docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < ~/backups/bolsiq-AAAAMMDDTHHMMSSZ.dump
```

```bash
cd ~/bolsiq && docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT timescaledb_post_restore();"'
```

```bash
cd ~/bolsiq && docker compose up -d --wait && bash smoke.sh http://localhost:8000
```

O `pg_restore` pode avisar sobre objetos de extensão já existentes; isso é
esperado com TimescaleDB. Erros em tabelas da aplicação não são.

## Trocar o tamanho da VM

Ver os tamanhos disponíveis no host atual:

```bash
az vm list-vm-resize-options -g rg-bolsiq -n vm-bolsiq -o table
```

Trocar (reinicia a VM; o compose volta sozinho):

```bash
az vm deallocate -g rg-bolsiq -n vm-bolsiq
```

```bash
az vm resize -g rg-bolsiq -n vm-bolsiq --size Standard_B2as_v2
```

```bash
gh workflow run vm-start.yml
```

`Standard_B2as_v2` tem 8 GiB (o dobro do atual) por cerca do dobro do preço.
Atualize o ADR 0030 e o budget se o custo mudar.

## Preparar uma VM nova

Se precisar recriar a VM, depois do `az vm create` (parâmetros na tabela do
topo):

```bash
scp -i ~/.ssh/bolsiq_deploy -r infra/azure bolsiq@<ip>:/tmp/azure
```

```bash
ssh -i ~/.ssh/bolsiq_deploy bolsiq@<ip> bash /tmp/azure/setup-vm.sh
```

O script instala Docker, 2 GB de swap, fail2ban, unattended-upgrades, o
`bolsiq.service` e o cron de backup. Depois, rode o deploy de produção
(`docs/runbooks/release.md`) e atualize o secret `SSH_HOST` se o IP mudou.

## Custos

```bash
az consumption budget show --budget-name budget-bolsiq
```

O budget está na moeda de cobrança da assinatura (BRL), equivalente a US$ 40.

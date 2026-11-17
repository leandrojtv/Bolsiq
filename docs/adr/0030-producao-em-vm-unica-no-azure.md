# ADR 0030 - Produção numa VM única no Azure com desligamento noturno

- **Status:** aceito
- **Data:** 2026-11-17
- **Decisores:** @leandrojtv

## Contexto

O projeto precisa de um ambiente de produção, pelo menor custo possível, para
uso próprio e validação. O `compose.prod.yml` já descrevia o deploy por SSH e
Docker Compose (ADR 0014), mas não havia host. O CD de staging também não
rodava: todo merge em `develop` terminava em `startup_failure` (#52).

Requisitos:

- custo mensal previsível, abaixo de US$ 40;
- Postgres 17 com TimescaleDB completo: o CLAUDE.md prevê hypertables e
  **continuous aggregates** via migrations;
- HTTPS com certificado válido e DNS;
- ninguém usa o sistema de madrugada: ele pode ficar desligado.

## Opções consideradas

1. **VM única com Docker Compose, desligada à noite.**
2. **Azure Container Apps + Azure Database for PostgreSQL Flexible Server.**
3. **VM sempre ligada.**

## Decisão

Opção 1: uma VM `Standard_B2als_v2` (2 vCPU, 4 GiB, burstable) com Ubuntu
24.04 em `eastus2`, rodando o `compose.prod.yml` inteiro. Disco StandardSSD de
64 GB, IP público estático Standard e o label DNS
`bolsiq.eastus2.cloudapp.azure.com`.

- **Borda:** Caddy publica 80 e 443 e emite o certificado (Let's Encrypt)
  sozinho; encaminha para o Kong, que publica 8000 só em `127.0.0.1`. O NSG
  libera apenas 22, 80 e 443. Postgres, NATS e o admin do Kong não saem da
  rede interna do compose.
- **Desligamento:** auto-shutdown nativo da VM às 23:00 BRT (02:00 UTC), que
  desaloca a VM e para a cobrança de computação. O `bolsiq.service` (systemd)
  roda `docker compose stop` no desligamento, para o Postgres fechar limpo.
- **Religamento:** o workflow `vm-start.yml` roda às 09:00 BRT (12:00 UTC),
  faz `az vm start` com OIDC (app registration com "Virtual Machine
  Contributor" só na VM, sem segredo de longa duração) e roda o smoke pelo SSH.
  No boot, o `bolsiq.service` sobe o compose sozinho.
- **Jobs na janela desligada:** os crons do market-data entre 23:00 e 09:00
  (CVM, BCB, COTAHIST lacunas) são reenfileirados ao subir pela recuperação do
  ADR 0029. Rodam por volta de 09:05, não no horário.
- **Backup:** `pg_dump` diário às 22:30 BRT, formato custom comprimido, 7 dias
  no disco da VM. Sem storage account.
- **Staging:** não existe host. O `cd-develop.yml` continua publicando as
  imagens no GHCR, e o deploy de staging só roda com a variável de repositório
  `STAGING_ENABLED=true`. A promoção para produção usa essas imagens.

Custo estimado (preço de tabela, `eastus2`): VM ligada 14 h/dia, cerca de
US$ 16; disco, US$ 5; IP estático, US$ 4 (cobrado também com a VM
desligada). Total perto de **US$ 25/mês**. Budget de US$ 40 no resource group,
com alerta em 80% e 100%.

O Azure Hybrid Benefit não se aplica: Ubuntu não tem licença a descontar.

## Por que não Container Apps nem PostgreSQL Flexible

- O **PostgreSQL Flexible Server** oferece TimescaleDB só na edição Apache 2.
  Ela não tem continuous aggregates, compressão nem políticas de retenção. As
  migrations de hoje ainda não usam esses recursos, mas a stack os prevê para
  as séries de cotação; adotar o Flexible fecharia esse caminho ou obrigaria a
  manter agregados como tabelas atualizadas por job.
- O menor Flexible Server (B1ms) já custa perto de US$ 15/mês com disco. Ele
  pode ser parado, mas religa sozinho depois de 7 dias.
- **Container Apps** cobra por vCPU e memória ativas. Com sete processos
  sempre ligados (workers com pg-boss e consumidores NATS não escalam para
  zero), passa do custo da VM. E o NATS JetStream precisaria de volume
  persistente (Azure Files), o que é mais um recurso e mais latência.
- Os dois juntos custariam várias vezes a VM e trocariam o `compose.prod.yml`,
  que já é testado no CI, por outra forma de deploy.

## Consequências

- Ponto único de falha: se a VM cair, tudo cai. Aceitável para o estágio atual.
- O sistema fica fora do ar das 23:00 às 09:00 BRT. Para vender a API pública
  (ADR 0007), esta decisão precisa ser revista.
- Backup no mesmo disco não protege contra perda da VM. O próximo passo, quando
  houver dado que não se recompõe, é copiar o dump para fora (ex.: storage com
  tier cool).
- Trocar o tamanho da VM é desalocar, `az vm resize` e ligar
  (`docs/runbooks/infra-azure.md`).
- Os secrets de deploy ficam nos environments `production` e
  `production-rollback`. O `vm-start.yml` usa o `production-rollback`, que não
  tem required reviewers: ligar a VM não pode esperar aprovação.

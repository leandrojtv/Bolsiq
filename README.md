# Bolsiq

Plataforma de comparação e análise de ativos da B3 — ações, FIIs, BDRs, ETFs e
fundos. O serviço de dados (`market-data`) é o produto principal e será vendido
como API pública.

O contexto completo do projeto — objetivo, arquitetura, stack e regras — está em
[CLAUDE.md](CLAUDE.md).

## Status

Em estruturação. O repositório tem hoje o fluxo de branches, o CI/CD e a
documentação; os serviços ainda não foram escritos.

| Parte | Estado |
| --- | --- |
| Fluxo de branches e rulesets | pronto, versionado em [infra/github](infra/github) |
| CI de PR (11 checks + `ci-ok`) | pronto; jobs que dependem do código ficam pulados até o monorepo existir |
| CD staging e produção | pronto; inativo até haver imagens em [deployables.json](infra/docker/deployables.json) |
| Documentação e runbooks | pronta, em [docs/](docs) |
| Monorepo e serviços | não iniciados |

## Começando

Nada aqui exige Node, pnpm ou psql instalados. Só Docker e make.

```bash
make help     # lista os alvos
make check    # actionlint, links e gitleaks — já funciona
```

## Documentação

- [Como contribuir](docs/contributing.md) — branches, commits, PR, release, hotfix
- [CI/CD](docs/ci-cd.md) — workflows, checks, secrets, environments
- [Fontes de dados do market-data](docs/services/market-data-sources.md) — URL, formato, licença e mapeamento de campos
- [Decisões de arquitetura](docs/adr/README.md)
- Runbooks: [release](docs/runbooks/release.md) · [hotfix](docs/runbooks/hotfix.md) · [rollback](docs/runbooks/rollback.md) · [reprocessar fonte](docs/runbooks/reprocessar-fonte.md)

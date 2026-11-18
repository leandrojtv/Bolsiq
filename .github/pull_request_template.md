## Contexto

<!-- Por que esta mudança existe. Link da issue é obrigatório. -->

Closes #

## Mudanças

<!-- O que mudou, em tópicos. Foque no "o quê" e no "por quê", não no diff. -->

-

## Como testar

<!-- Passos reproduzíveis. Comandos via Docker/make, nunca dependentes de instalação local. -->

```bash
make up
make test
```

## Checklist

- [ ] Título do PR em Conventional Commits (`tipo(escopo): descrição`)
- [ ] Branch no padrão `<tipo>/<issue>-<slug>` e base correta (`develop`, ou `main` só para `release/*` e `hotfix/*`)
- [ ] `make lint test` passou localmente, dentro do Docker
- [ ] Endpoints novos ou alterados têm schema Zod, aparecem no OpenAPI e têm teste
- [ ] Dados de mercado novos gravam proveniência (`source`, `fetched_at`, `license`, `source_ref`)
- [ ] Valores monetários em `numeric` e datas em `timestamptz` (UTC)
- [ ] `docs/` atualizado (ou label `no-docs` com justificativa no PR)
- [ ] ADR criado em `docs/adr` se houve decisão de arquitetura nova
- [ ] Migrations versionadas e aplicáveis num banco limpo, sem drift
- [ ] `.env.example` atualizado se surgiu variável de ambiente nova
- [ ] Nenhum segredo no código ou nos testes

## Impacto em contrato `/v1`

- [ ] Sem mudança de contrato
- [ ] Mudança retrocompatível (campo novo opcional, endpoint novo)
- [ ] **Breaking change** — exige label `breaking-change` e nota de migração em `docs/`

# Projeto: plataforma de análise de ações

Objetivo: sistema de comparação e análise de ativos da B3 (ações, FIIs, BDRs, ETFs, fundos), no estilo Mais Retorno + TradingView. No futuro, o serviço de dados será vendido como API pública (concorrente da brapi).

## Arquitetura

- **market-data** (serviço, produto principal): adapters por fonte (brapi, CVM, B3 COTAHIST, BCB SGS; FMP/EODHD no futuro), cache sob demanda (read-through) gravando no Postgres, normalização, API pública versionada `/v1` (REST + WebSocket). Nenhum outro serviço acessa fontes externas diretamente.
- **app** (Next.js): UI + BFF. Contém os módulos `analytics`, `portfolio` e `alerts`, cada um em pacote próprio com fronteira explícita, prontos para virar serviço.
- **gateway** (Kong OSS): chaves de API, rate limit por plano, medição de uso.
- **eventos**: NATS JetStream; publicação via outbox no Postgres.
- **bancos**: um Postgres 17 + TimescaleDB por serviço (schemas separados enquanto estiverem no mesmo cluster). Cada serviço é dono dos seus dados; não há join entre schemas de serviços diferentes.

## Stack

- TypeScript estrito em tudo, Node 22 LTS, pnpm workspaces + Turborepo.
- Serviços: Fastify, Zod para validação, OpenAPI gerado a partir dos schemas Zod.
- Banco: Drizzle ORM + migrations versionadas; hypertables e continuous aggregates via SQL nas migrations.
- Jobs: pg-boss (fila no próprio Postgres).
- Front: Next.js (App Router), Tailwind, shadcn/ui, TanStack Query, TradingView Lightweight Charts, ECharts. Responsivo e PWA.
- Testes: Vitest; Testcontainers para integração; Playwright para E2E.
- Observabilidade: OpenTelemetry, logs JSON (pino).

## Estrutura do monorepo

```
apps/web
services/market-data
packages/{contracts, db-core, domain, ui, config}
infra/{docker, kong, nats, observability}
docs/{adr, services, runbooks}
```

## Regras

1. Tudo roda via Docker Compose; nada depende de instalação local além de Docker e make.
2. Toda decisão de arquitetura nova vira um ADR em `docs/adr` (formato MADR, numerado).
3. Todo endpoint tem schema Zod, aparece no OpenAPI e tem teste.
4. Todo dado de mercado guarda proveniência: `source`, `fetched_at`, `license`, `source_ref`.
5. Valores monetários em `numeric`, nunca `float`. Datas em `timestamptz` (UTC); exibição em `America/Sao_Paulo`.
6. Segredos só por variável de ambiente; `.env.example` sempre atualizado.
7. Commits no padrão Conventional Commits.
8. Documentação e mensagens em português; identificadores de código em inglês.

## Fluxo de trabalho

Em TODA tarefa:

1. Identifique o tipo (feature, fix, hotfix, chore, docs, refactor, test). Se não houver issue, crie uma com `gh issue create` usando o template.
2. Atualize a base (`git fetch`; `develop`, ou `main` para hotfix) e crie a branch no padrão `<tipo>/<issue>-<slug>`. Nunca trabalhe direto em `main` ou `develop`.
3. Commits pequenos em Conventional Commits, referenciando a issue (ex.: `feat(market-data): adiciona adapter CVM (#12)`).
4. Antes de cada push: `make lint test` dentro do Docker. Não faça push com falha.
5. Atualize `docs/`, ADR quando houver decisão nova e `.env.example` quando houver variável nova.
6. Abra o PR com `gh pr create` para a base correta, preenchendo o template, linkando a issue (`Closes #N`) e com labels.
7. Acompanhe os checks (`gh pr checks --watch`). Se falhar, corrija na mesma branch; nunca desative teste ou check para passar.
8. Nunca: force push em branch compartilhada, merge sem CI verde, commit de segredo, alterar rulesets sem pedido explícito.
9. Ao terminar, responda com: branch, link do PR, status dos checks e o que falta para o merge.

### Referências

- Modelo de branches, commits, PR, release e hotfix: [docs/contributing.md](docs/contributing.md)
- Workflows, checks, secrets e environments: [docs/ci-cd.md](docs/ci-cd.md)
- Runbooks: [release](docs/runbooks/release.md), [hotfix](docs/runbooks/hotfix.md), [rollback](docs/runbooks/rollback.md)
- Decisão de fluxo e CI/CD: [ADR 0014](docs/adr/0014-fluxo-de-branches-e-cicd.md)

# CLAUDE.md - Coding Profile
# Best for: dev projects, code review, debugging, refactoring
# Extends: Universal CLAUDE.md rules

---

## Output
- Return code first. Explanation after, only if non-obvious.
- No inline prose. Use comments sparingly - only where logic is unclear.
- No boilerplate unless explicitly requested.

## Code Rules
- Simplest working solution. No over-engineering.
- No abstractions for single-use operations.
- No speculative features or "you might also want..."
- Read the file before modifying it. Never edit blind.
- No docstrings or type annotations on code not being changed.
- No error handling for scenarios that cannot happen.
- Three similar lines is better than a premature abstraction.

## Review Rules
- State the bug. Show the fix. Stop.
- No suggestions beyond the scope of the review.
- No compliments on the code before or after the review.

## Debugging Rules
- Never speculate about a bug without reading the relevant code first.
- State what you found, where, and the fix. One pass.
- If cause is unclear: say so. Do not guess.

## Simple Formatting
- No em dashes, smart quotes, or decorative Unicode symbols.
- Plain hyphens and straight quotes only.
- Natural language characters (accented letters, CJK, etc.) are fine when the content requires them.
- Code output must be copy-paste safe.

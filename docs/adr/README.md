# Decisões de arquitetura

Formato [MADR](https://adr.github.io/madr/), numerado em sequência, em
português. Um arquivo por decisão; decisão revista ganha ADR novo que marca a
anterior como `substituído por`.

| ADR | Título | Status |
| --- | --- | --- |
| [0006](0006-jobs-no-proprio-servico.md) | Jobs no próprio serviço, com pg-boss e `ROLE` | aceito |
| [0014](0014-fluxo-de-branches-e-cicd.md) | Fluxo de branches e CI/CD | aceito |

## Sobre a numeração começar em 0014

Não há 0001 a 0013. O `CLAUDE.md` já traz um conjunto de decisões tomadas —
Postgres 17 com TimescaleDB por serviço, NATS JetStream com outbox, Kong OSS no
gateway, pg-boss para filas, Drizzle, pnpm com Turborepo, Fastify com Zod,
monorepo com fronteira explícita entre módulos — e nenhuma delas tem ADR.

Pela regra 2 do `CLAUDE.md`, toda decisão de arquitetura vira ADR. Essas
precedem a regra, então a lacuna é dívida consciente: os números de 0001 a 0013
ficam reservados para quando cada uma for escrita. Vale escrever ao menos as que
são difíceis de reverter depois:

| Número reservado | Decisão a documentar |
| --- | --- |
| 0001 | Monorepo com pnpm workspaces e Turborepo |
| 0002 | TypeScript estrito em todo o repositório |
| 0003 | Fastify com Zod e OpenAPI gerado dos schemas |
| 0004 | Postgres 17 com TimescaleDB, um banco por serviço |
| 0005 | Drizzle ORM com migrations versionadas |
| 0007 | NATS JetStream com publicação via outbox |
| 0008 | Kong OSS como gateway; chaves, rate limit e medição de uso |
| 0009 | Cache read-through no market-data como estratégia de ingestão |
| 0010 | Proveniência obrigatória em todo dado de mercado |
| 0011 | `numeric` para moeda e `timestamptz` para data |
| 0012 | Next.js App Router como UI e BFF |
| 0013 | Módulos analytics, portfolio e alerts em pacotes prontos para virar serviço |

A 0008 é a mais urgente: rate limit por plano e medição de uso para cobrança
costumam exigir plugin da versão paga do Kong ou plugin próprio em Lua, e isso
muda custo e cronograma.

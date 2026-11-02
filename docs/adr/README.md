# Decisões de arquitetura

Formato [MADR](https://adr.github.io/madr/), numerado em sequência, em
português. Um arquivo por decisão; decisão revista ganha ADR novo que marca a
anterior como `substituído por`.

| ADR | Título | Status |
| --- | --- | --- |
| [0006](0006-jobs-no-proprio-servico.md) | Jobs no próprio serviço, com pg-boss e `ROLE` | aceito |
| [0007](0007-gateway-e-planos.md) | Gateway, chaves de API e planos | **proposto** |
| [0014](0014-fluxo-de-branches-e-cicd.md) | Fluxo de branches e CI/CD | aceito |

## Sobre a numeração começar em 0006

Não há 0001 a 0005, nem 0008 a 0013. O `CLAUDE.md` já traz um conjunto de
decisões tomadas — Postgres 17 com TimescaleDB por serviço, NATS JetStream com
outbox, Drizzle, pnpm com Turborepo, Fastify com Zod, monorepo com fronteira
explícita entre módulos — e nenhuma delas tem ADR.

Pela regra 2 do `CLAUDE.md`, toda decisão de arquitetura vira ADR. Essas
precedem a regra, então a lacuna é dívida consciente: os números abaixo ficam
reservados para quando cada uma for escrita. Vale escrever ao menos as que são
difíceis de reverter depois.

| Número reservado | Decisão a documentar |
| --- | --- |
| 0001 | Monorepo com pnpm workspaces e Turborepo |
| 0002 | TypeScript estrito em todo o repositório |
| 0003 | Fastify com Zod e OpenAPI gerado dos schemas |
| 0004 | Postgres 17 com TimescaleDB, um banco por serviço |
| 0005 | Drizzle ORM com migrations versionadas |
| 0008 | Cache read-through no market-data como estratégia de ingestão |
| 0009 | NATS JetStream com publicação via outbox |
| 0010 | Proveniência obrigatória em todo dado de mercado |
| 0011 | `numeric` para moeda e `timestamptz` para data |
| 0012 | Next.js App Router como UI e BFF |
| 0013 | Módulos analytics, portfolio e alerts em pacotes prontos para virar serviço |

O [ADR 0007](0007-gateway-e-planos.md) já cobre o gateway, que era a decisão
mais urgente da lista: rate limit por plano e medição de uso para cobrança. Ele
está como **proposto**, não aceito, porque recomenda mover a autenticação para
dentro do `market-data` — o que contraria o papel que o `CLAUDE.md` atribui ao
Kong, e portanto é decisão do dono do projeto.

A mais urgente entre as que faltam é a **0004**: um banco por serviço com
schemas separados no mesmo cluster é fácil de escrever e difícil de desfazer
depois que houver dado em produção.

# Decisões de arquitetura

Formato [MADR](https://adr.github.io/madr/), numerado em sequência, em
português. Um arquivo por decisão; decisão revista ganha ADR novo que marca a
anterior como `substituído por`.

| ADR                                          | Título                                          | Status       |
| -------------------------------------------- | ----------------------------------------------- | ------------ |
| [0006](0006-jobs-no-proprio-servico.md)      | Jobs no próprio serviço, com pg-boss e `ROLE`   | aceito       |
| [0007](0007-gateway-e-planos.md)             | Gateway, chaves de API e planos                 | **proposto** |
| [0008](0008-outbox-e-jetstream.md)           | Outbox no Postgres com NATS JetStream           | aceito       |
| [0009](0009-analytics-como-modulo.md)        | Analytics como modulo, com critario de extracao | aceito       |
| [0010](0010-better-auth.md)                  | Better Auth para autenticacao                   | aceito       |
| [0011](0011-rls.md)                          | Row Level Security como segunda barreira        | aceito       |
| [0012](0012-alerts-worker.md)                | Processo e imagem dedicados para o alerts       | aceito       |
| [0013](0013-cache-read-through.md)           | Read-through, com carga em lote para arquivo    | aceito       |
| [0014](0014-fluxo-de-branches-e-cicd.md)     | Fluxo de branches e CI/CD                       | aceito       |
| [0015](0015-design-system.md)                | Design system em packages/ui                    | aceito       |
| [0018](0018-analytics-worker.md)             | Processo dedicado para o recálculo do analytics | aceito       |
| [0020](0020-bff-do-web.md)                   | BFF do apps/web, chave só no servidor           | aceito       |
| [0021](0021-identidade-provisoria-e-sino.md) | Identidade provisória e sino por SSE            | aceito       |
| [0022](0022-login-carteira-e-snapshot.md)    | Login, RLS por transação, snapshot e LGPD       | aceito       |
| [0024](0024-assistente-byok.md)              | Assistente com a chave do usuário (BYOK)        | aceito       |
| [0025](0025-posicoes-sem-ticker.md)          | Posições sem ticker e carga por fotografia      | aceito       |

## Números reservados

O `CLAUDE.md` traz decisões tomadas antes da regra 2 (toda decisão vira ADR).
Os números abaixo ficam reservados para quando cada uma for escrita. A mais
urgente é a 0004: um banco por serviço com schemas separados no mesmo cluster é
fácil de escrever e difícil de desfazer depois que houver dado em produção.

| Número | Decisão a documentar                              |
| ------ | ------------------------------------------------- |
| 0001   | Monorepo com pnpm workspaces e Turborepo          |
| 0002   | TypeScript estrito em todo o repositório          |
| 0003   | Fastify com Zod e OpenAPI gerado dos schemas      |
| 0004   | Postgres 17 com TimescaleDB, um banco por serviço |
| 0005   | Drizzle ORM com migrations versionadas            |
| 0015   | Proveniência obrigatória em todo dado de mercado  |
| 0016   | `numeric` para moeda e `timestamptz` para data    |
| 0017   | Next.js App Router como UI e BFF                  |

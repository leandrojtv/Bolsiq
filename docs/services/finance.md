# finance (Bolsiq Finanças)

Módulo de finanças pessoais do Bolsiq: contas, categorias e lançamentos. Nome e
navegação próprios, mesmo login. Pacote `packages/finance`, schema `finance` no
banco. Decisão em [ADR 0031](../adr/0031-bolsiq-financas.md).

Não lê nem faz join com `portfolio`, `app`, `analytics` ou `market_data`. O Painel
geral (`/painel`) vai compor os módulos pelo BFF, nunca por SQL entre schemas.

## Estado atual

| Parte                                                       | Estado                                          |
| ----------------------------------------------------------- | ----------------------------------------------- |
| Contas, categorias e lançamentos (CRUD)                     | pronto, BFF em `/api/financas/*` com OpenAPI    |
| Transferência entre contas (par de lançamentos)             | pronto; não conta como receita nem despesa      |
| Categorias padrão semeadas no primeiro acesso               | pronto, idempotente                             |
| Schema com RLS forçada e FKs compostas pelo dono            | pronto, testes contra Postgres real             |
| Telas `/financas`, `/contas`, `/lancamentos`, `/categorias` | prontas, com lançamento rápido (Enter salva)    |
| Seletor de módulo e entrada pelo último módulo usado        | pronto (cookie `bolsiq_modulo`)                 |
| `/painel`                                                   | só a rota, com estado vazio                     |
| Cartões, faturas, recorrências, dashboard do mês            | próxima etapa                                   |
| Importação de extrato (OFX)                                 | etapa seguinte; desenho de parser por interface |

## Modelo de dados

| Tabela         | Chave                                                               |
| -------------- | ------------------------------------------------------------------- |
| `accounts`     | `id`, único por `(user_id, nome)` e `(user_id, id)`                 |
| `categories`   | `id`, único por `(user_id, parent_id, nome)` (`NULLS NOT DISTINCT`) |
| `transactions` | `id`, único parcial `(user_id, hash_dedupe)`                        |
| `audit_log`    | `id`, append-only                                                   |
| `outbox`       | `id`; eventos `finance.*` (publicador entra com o primeiro)         |

- Valores em `numeric(18,2)`, sempre positivos; o sinal sai do `tipo` e, na
  transferência, de `transferencia_sentido` (`saida` ou `entrada`).
- `competencia` é o primeiro dia do mês do lançamento (check no banco).
- O saldo inicial vale no **início** de `data_saldo_inicial`. Saldo atual conta
  só `realizado` e `conciliado`; `previsto` entra no saldo previsto.
- `user_id` repetido em toda tabela para a política de RLS não precisar de
  subconsulta, e nas FKs: a checagem de FK ignora a RLS, e a chave composta
  impede apontar para a conta ou a categoria de outro usuário.
- Categorias `sistema` (Tarifas bancárias, Juros e encargos, IOF) não se apagam
  nem trocam de natureza.

As migrations são aplicadas pelo passo de migrate do `portfolio-worker`, journal
`drizzle_finance`.

## BFF

Todas as rotas exigem a sessão (401 sem ela) e validam com Zod (422). O
documento OpenAPI sai dos mesmos schemas em `/api/financas/openapi.json`, e
`apps/web/lib/financas-bff.test.ts` reprova rota sem entrada nele.

| Rota                               | Métodos              |
| ---------------------------------- | -------------------- |
| `/api/financas/contas`             | GET, POST            |
| `/api/financas/contas/{id}`        | PATCH, DELETE        |
| `/api/financas/categorias`         | GET, POST            |
| `/api/financas/categorias/{id}`    | PATCH, DELETE        |
| `/api/financas/lancamentos`        | GET (paginado), POST |
| `/api/financas/lancamentos/{id}`   | PATCH, DELETE        |
| `/api/financas/resumo?mes=YYYY-MM` | GET                  |
| `/api/financas/openapi.json`       | GET                  |

Filtros da listagem: `de`, `ate`, `conta`, `categoria`, `status`, `q` (texto, com
e sem acento), `pagina`, `por_pagina` (até 200). Conta com lançamento não se
apaga (409): arquive.

## Testes

- `packages/finance`: unitários de saldo, totais do mês e transferência
  (`make test`) e integração com Testcontainers provando a RLS
  (`make test-integration`).
- `apps/web/e2e/financas.spec.ts`: criar conta, lançar despesa, ver na lista e
  voltar para Finanças depois do login.

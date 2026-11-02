# CI/CD

Tudo que roda no GitHub Actions, o que é obrigatório, quais secrets existem e
como reproduzir o CI na sua máquina.

## Workflows

| Workflow | Gatilho | Jobs | Tempo médio | Obrigatório |
| --- | --- | --- | --- | --- |
| [ci.yml](../.github/workflows/ci.yml) | PR para `main` ou `develop`; merge group | `pr-meta`, `changes`, `lint`, `typecheck`, `unit`, `integration`, `migrations`, `contract`, `build`, `smoke`, `e2e`, `security`, `docs-check`, `ci-ok` | 6–9 min com cache quente | **Sim** — só o `ci-ok` |
| [cd-develop.yml](../.github/workflows/cd-develop.yml) | push em `develop` | `matriz`, `build-push`, `deploy-staging` | 5–8 min | Não |
| [release-please.yml](../.github/workflows/release-please.yml) | push em `main` | `release-please` | < 1 min | Não |
| [cd-production.yml](../.github/workflows/cd-production.yml) | tag `vX.Y.Z` | `resolver`, `promover`, `deploy-producao`, `rollback`, `aviso-rollback` | 3–5 min + espera pela aprovação | Não |
| [hotfix-backmerge.yml](../.github/workflows/hotfix-backmerge.yml) | PR de `hotfix/*` ou `release/*` mergeado em `main` | `back-merge` | < 1 min | Não |
| [claude-review.yml](../.github/workflows/claude-review.yml) | PR para `main` ou `develop` | `revisar` | 1–3 min | Não |
| [claude-mention.yml](../.github/workflows/claude-mention.yml) | `@claude` em issue, PR ou comentário | `responder` | variável | Não |
| [codeql.yml](../.github/workflows/codeql.yml) | PR para `main`; segunda 04:00 UTC | `analisar` (matriz) | 3–6 min | Não |
| [labeler.yml](../.github/workflows/labeler.yml) | PR aberto ou atualizado | `labeler` | < 30 s | Não |
| [deploy.yml](../.github/workflows/deploy.yml) | `workflow_call` | `deploy` | 2–4 min | — |

Os tempos são estimativas de projeto, não medições: nenhum serviço existe ainda.
Atualize esta coluna quando houver histórico real.

### Só o `ci-ok` é obrigatório

As rulesets exigem um único check: `ci-ok`. Ele depende de todos os outros e
reprova se qualquer um falhar ou for cancelado. Resultado `skipped` conta como
sucesso, porque significa que o job não se aplica àquele diff.

A razão é prática: acrescentar, renomear ou remover um job não exige mexer na
proteção das branches. Sem isso, cada mudança no CI viraria uma mudança de
ruleset — e uma ruleset que exige um check que não existe mais travaria todos
os PRs.

### O que cada check cobra

| Job | O que reprova |
| --- | --- |
| `pr-meta` | Título fora de Conventional Commits; nome de branch fora do padrão; slug acima de 50 caracteres; origem não permitida para a base (`feature/*` → `main`, por exemplo). Aplica `size:XS..XL` e avisa acima de 600 linhas. |
| `lint` | ESLint ou Prettier. |
| `typecheck` | `tsc`. |
| `unit` | Vitest, incluindo o piso de cobertura definido no `vitest.config` **de cada pacote**. Comenta o resumo de cobertura no PR. |
| `integration` | Testes com Postgres+Timescale e NATS reais, via Testcontainers. |
| `migrations` | Migrations que não aplicam num banco limpo, ou drift entre o schema do Drizzle e as migrations versionadas. |
| `contract` | Quebra incompatível em `/v1`, comparada com a base via `oasdiff`. Liberado pela label `breaking-change`. |
| `build` | Falha no build de qualquer imagem afetada. Sem push em PR. |
| `smoke` | Algum container não fica `healthy`, ou algum endpoint de health não responde 200 através do Kong. |
| `e2e` | Playwright, quando `apps/web` ou os contratos mudam. |
| `security` | gitleaks (segredo no código ou no histórico) e Trivy (HIGH/CRITICAL com correção disponível). |
| `docs-check` | Código de serviço alterado sem nada em `docs/`, salvo com a label `no-docs`. Também reprova link quebrado em Markdown. |

### Estado atual: jobs pulados

O monorepo ainda não existe. Enquanto não houver `pnpm-workspace.yaml`, os jobs
`lint`, `typecheck`, `unit`, `integration`, `migrations`, `contract`, `build`,
`smoke` e `e2e` são pulados, e o `ci-ok` fecha verde com o que resta
(`pr-meta`, `security`, `docs-check`). O job `changes` emite um aviso dizendo
isso na execução.

Vão ligando sozinhos conforme os arquivos aparecem:

| Job | Liga quando existir |
| --- | --- |
| `lint`, `typecheck`, `unit` | `pnpm-workspace.yaml` |
| `integration` | `pnpm-workspace.yaml` + mudança em `services/`, `packages/db-core` ou `infra/docker` |
| `migrations` | mudança em `packages/db-core`, `**/migrations/**` ou `drizzle.config.ts` |
| `contract` | alvo `openapi:generate` no Turborepo |
| `build` | entradas em [`infra/docker/deployables.json`](../infra/docker/deployables.json) |
| `smoke`, `e2e` | `infra/docker/compose.ci.yml` |

## Otimizações de tempo

- **Escopo pelo diff.** O job `changes` usa `dorny/paths-filter` e os demais
  rodam `turbo --filter="...[origin/<base>]"`, ou seja, só os pacotes afetados
  e seus dependentes.
- **Cache do pnpm.** Via `actions/setup-node` com `cache: pnpm`.
- **Cache do Turborepo.** Diretório `.turbo` em `actions/cache`, com
  `restore-keys` para aproveitar execuções anteriores.
- **Cache do Docker.** buildx com `type=gha`, escopo por imagem.
- **Concorrência.** PR novo cancela a execução anterior do mesmo PR
  (`cancel-in-progress`). O CD de staging e o de produção **não** cancelam:
  deploy pela metade é pior que deploy lento.
- **Imagens pré-baixadas** no job de integração, em paralelo.

Meta: menos de 10 minutos para um PR típico com cache quente.

## Secrets

Configure em Settings → Secrets and variables → Actions.

| Secret | Escopo | Para que serve | Sem ele |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | repositório | Revisão automática do Claude e respostas a `@claude` | Os dois workflows do Claude falham; o resto do CI segue |
| `SSH_HOST` | environment | Host de deploy | Deploy falha |
| `SSH_USER` | environment | Usuário SSH | Deploy falha |
| `SSH_KEY` | environment | Chave privada de deploy, sem passphrase | Deploy falha |
| `SSH_PORT` | environment | Porta SSH (opcional; padrão 22) | Usa 22 |
| `ENV_FILE` | environment | Conteúdo completo do `.env` daquele ambiente | Deploy falha |
| `RELEASE_PLEASE_TOKEN` | repositório | PAT para o release-please. Opcional, mas **recomendado**: com o `GITHUB_TOKEN` padrão, o PR de release não dispara o CI, e o `ci-ok` nunca fica verde | O PR de release precisa de um push manual para rodar o CI |

Os secrets de deploy são **por environment**, não do repositório: é isso que
permite `staging` e `production` apontarem para hosts diferentes. Por isso o
`deploy.yml` não declara `secrets:` em `workflow_call` e os chamadores usam
`secrets: inherit` — quem resolve o valor é o job que declara o `environment`.

O secret `PGK_TOKEN`, que já existe no repositório, não é usado por nenhum
workflow. Se a intenção era `PKG_TOKEN` para publicar pacotes, ainda não há o
que publicar: o push para o GHCR usa o `GITHUB_TOKEN` automático.

## Environments

| Environment | Quem usa | Proteção |
| --- | --- | --- |
| `staging` | `cd-develop.yml` | Nenhuma. Merge em `develop` publica direto. |
| `production` | `cd-production.yml` | **Required reviewers.** É aqui que vive a aprovação manual do deploy de produção. |
| `production-rollback` | job `rollback` | Mesmos secrets de produção, **sem** required reviewers. |

O `production-rollback` existe por um motivo específico: se o rollback usasse o
environment `production`, ele esperaria aprovação humana — com a produção
quebrada e ninguém necessariamente acordado. Rollback automático só é automático
se não tiver portão.

`make gh-protect` cria os três environments. Os required reviewers do
`production` são configurados na interface, de propósito: definir quem aprova
deploy é decisão humana, não script.

## Proteção como código

As rulesets são JSON versionado em [infra/github/rulesets](../infra/github/rulesets).

```bash
make gh-protect-dry     # mostra o que faria
make gh-protect         # aplica
make gh-protect-solo    # aplica sem exigir aprovação em main
make gh-status          # mostra o estado atual
```

### `main`

- PR obrigatório, 1 aprovação de CODEOWNERS
- `ci-ok` verde e branch atualizada com a base
- conversas resolvidas; aprovação invalidada por push novo
- sem force push, sem deleção
- merge por merge commit
- origem restrita a `release/*` e `hotfix/*` — **não** pela ruleset, e sim pelo
  check `pr-meta`, porque o GitHub não expressa restrição de branch de origem em
  rulesets

### `develop`

- PR obrigatório, sem exigência de aprovação
- `ci-ok` verde e branch atualizada com a base
- conversas resolvidas
- sem force push, sem deleção
- merge por squash

### Sobre o modo solo

`main` exige 1 aprovação de CODEOWNERS, e o GitHub não permite aprovar o próprio
PR. Num repositório com um único mantenedor, isso **trava todo merge em `main`**,
inclusive o PR de release do release-please.

`make gh-protect-solo` zera a exigência de aprovação em `main` e mantém o resto
(PR obrigatório, `ci-ok` verde, sem force push, sem deleção). Use enquanto for
uma pessoa só; volte ao `make gh-protect` quando houver um segundo mantenedor.

## Rodando o CI localmente

A maior parte não precisa do GitHub:

```bash
make check-workflows   # actionlint + shellcheck nos workflows
make check-actions     # confere que toda action referenciada existe
make check-links       # links quebrados no Markdown
make check-secrets     # gitleaks
make check             # os quatro

make lint              # ESLint + Prettier
make typecheck         # tsc
make test              # Vitest com cobertura
make test-integration  # Testcontainers
make ci                # lint + typecheck + test + integration
```

Tudo roda em container; não é preciso Node nem pnpm na máquina.

Para executar os workflows de verdade localmente, com
[act](https://github.com/nektos/act):

```bash
act pull_request -W .github/workflows/ci.yml --container-architecture linux/amd64
```

`make check-actions` existe por um motivo concreto: o actionlint valida sintaxe
e contexto, mas não verifica se a versão da action existe. Uma referência como
`aquasecurity/trivy-action@0.33.1` (a tag real é `v0.33.1`) passa no lint e só
falha no runner, com `unable to resolve action` — e derruba o job inteiro no
setup, antes de qualquer passo rodar.

O `act` não reproduz fielmente `environment`, OIDC, cache `type=gha` nem
`workflow_call` com `secrets: inherit`. Serve para depurar a lógica dos jobs,
não para dar o CI por aprovado.

## Automações

- **Renovate** ([config](../.github/renovate.json)): patch e minor agrupados num
  PR semanal (segunda, madrugada); major em PR separado, com aprovação pelo
  dependency dashboard; automerge de patch em `devDependencies` com CI verde.
  Alvo: `develop`. Node preso em `<23` e Postgres na linha 17, conforme o
  CLAUDE.md. **Requer o app do Renovate instalado no repositório.**
- **release-please** ([config](../release-please-config.json)): versão e
  CHANGELOG a partir dos Conventional Commits.
- **Labeler** ([config](../.github/labeler.yml)): labels `area:*` por caminho.
- **Revisão do Claude**: comenta risco de segurança, regressão, falta de teste e
  de documentação em todo PR. **Comenta; não aprova.** A aprovação continua
  humana.

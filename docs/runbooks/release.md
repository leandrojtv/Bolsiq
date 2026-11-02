# Runbook: release

Levar o que está em `develop` para produção.

**Pré-requisitos:** `develop` verde; acesso de merge em `main`; ser reviewer do
environment `production`.

## 1. Confira o que vai entrar

```bash
git fetch origin
git log --oneline origin/main..origin/develop
```

Todo commit releasable precisa estar em Conventional Commits — é daí que sai a
versão. Commit fora do padrão não aparece no CHANGELOG.

Confirme que o staging está com esse código e saudável:

```bash
gh run list --workflow cd-develop.yml --limit 3
make smoke BASE_URL=https://staging.seu-dominio   # ajuste a URL
```

## 2. Corte a branch de release

Decida a versão pelo que entrou: `feat` → minor, só `fix` → patch, `feat!` ou
`BREAKING CHANGE` → major.

```bash
git switch -c release/v1.2.0 origin/develop
git push -u origin release/v1.2.0
```

A partir daqui, **só `fix/*` entra nesta branch**. Funcionalidade nova vai para
`develop` e sai na próxima release.

## 3. PR para `main`

```bash
gh pr create --base main --head release/v1.2.0 \
  --title "chore(release): prepara v1.2.0" --fill
gh pr checks --watch
```

Aguarde `ci-ok` verde e a aprovação.

## 4. Merge (merge commit)

Pela ruleset, `main` só aceita merge commit — é o que preserva o histórico da
release.

```bash
gh pr merge --merge --delete-branch
```

## 5. PR de release do release-please

O push em `main` dispara o `release-please`, que abre (ou atualiza) o PR de
release com o CHANGELOG e o bump de versão.

```bash
gh pr list --label "autorelease: pending"
gh pr checks --watch <numero>
gh pr merge <numero> --merge
```

O merge cria a tag `v1.2.0` e o GitHub Release.

> Se o PR de release ficar com os checks pendentes para sempre, falta o secret
> `RELEASE_PLEASE_TOKEN`. Com o `GITHUB_TOKEN` padrão, o PR criado pela Action
> não dispara workflows. Veja [ci-cd.md](../ci-cd.md).

## 6. Deploy de produção

A tag dispara o `cd-production.yml`, que:

1. encontra o `sha-<commit>` já publicado e validado em staging, caminhando o
   histórico da tag;
2. **retagueia** essa imagem para `v1.2.0` e `production`, sem reconstruir;
3. para no environment `production`, esperando aprovação.

```bash
gh run list --workflow cd-production.yml --limit 1
gh run view <id>          # mostra a espera pela aprovação
```

Aprove na interface (Actions → a execução → Review deployments) e acompanhe:

```bash
gh run watch <id>
```

As migrations rodam como passo único antes de qualquer serviço subir. O smoke
roda depois. Se o smoke falhar, o rollback para a tag anterior é automático —
veja [rollback.md](rollback.md).

## 7. Back-merge para `develop`

O PR de back-merge é aberto sozinho pelo `hotfix-backmerge.yml`.

```bash
gh pr list --label back-merge
gh pr merge <numero> --squash
```

**Não deixe pendente.** Sem o back-merge, `develop` fica sem o commit de versão
e o release-please calcula a próxima versão errado.

## 8. Confira

```bash
gh release view v1.2.0
make smoke BASE_URL=https://seu-dominio
```

## Se algo der errado

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `resolver` falha com "nenhuma imagem de staging encontrada" | A release saiu de um ponto que nunca passou por `develop`, ou o CD de staging falhou | Não force. Garanta que o commit passou por `develop` e que o `cd-develop` publicou |
| PR de release com checks eternamente pendentes | Falta `RELEASE_PLEASE_TOKEN` | Configure o PAT, ou dê um push vazio na branch do PR |
| Merge em `main` bloqueado por falta de aprovação | Mantenedor único não aprova o próprio PR | `make gh-protect-solo` |
| Smoke de produção falha | Ver [rollback.md](rollback.md) | — |

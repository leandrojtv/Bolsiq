# Runbook: hotfix

Corrigir produção sem esperar o ciclo normal de release.

**Use hotfix quando:** produção está parada, ou a API está devolvendo dado
incorreto, ou há risco de segurança ativo.

**Não use hotfix quando:** dá para esperar a próxima release. Aí é `fix/*`
saindo de `develop`.

## 1. Issue

```bash
gh issue create --template bug.yml
```

Marque a severidade como crítica. O número da issue entra no nome da branch.

## 2. Branch a partir de `main`

Este é o ponto que mais se erra. Hotfix sai de **`main`**, não de `develop` —
`develop` pode ter trabalho inacabado que você não quer em produção agora.

```bash
git fetch origin
git switch -c hotfix/31-cotacao-nula origin/main
```

## 3. Corrija

Correção mínima, com teste que reproduz o bug.

O teste é obrigatório, inclusive com pressa: sem ele, nada impede a regressão de
voltar. Se o bug não é reproduzível em teste, escreva no PR por que.

```bash
git commit -m "fix(market-data): trata cotação nula em feriado (#31)"
make lint test
git push -u origin hotfix/31-cotacao-nula
```

## 4. PR para `main`

```bash
gh pr create --base main --head hotfix/31-cotacao-nula \
  --title "fix(market-data): trata cotação nula em feriado" --fill
gh pr checks --watch
```

> **Atenção.** O hotfix não passa por staging. O `resolver` do CD de produção
> procura uma imagem `sha-<commit>` publicada; o commit de hotfix só existe em
> `main` e nunca teve imagem construída. O `resolver` então promove a imagem do
> commit anterior **sem a sua correção**.
>
> Enquanto os serviços não existirem, isso é teórico. Quando existirem, escolha
> uma das duas saídas e registre em ADR:
>
> 1. Fazer o hotfix passar por `develop` primeiro (perde urgência, ganha
>    validação em staging).
> 2. Dar ao `cd-production.yml` um caminho de build direto da tag, aceitando que
>    a imagem de produção não foi validada em staging.

## 5. Merge e deploy

```bash
gh pr merge --merge --delete-branch
```

O release-please gera a versão patch e a tag. A tag dispara o CD de produção,
que espera sua aprovação no environment `production`.

```bash
gh run watch <id>
```

## 6. Back-merge para `develop` — obrigatório

O PR é aberto automaticamente.

```bash
gh pr list --label back-merge
gh pr merge <numero> --squash
```

**Mergeie no mesmo dia.** Se não, a próxima release sobrescreve a correção e o
bug volta em produção. É o jeito mais comum de um hotfix "desaparecer".

Se o back-merge vier com conflito, o workflow commita os marcadores de conflito
de propósito, para a resolução ser humana e revisável. Resolva na própria branch:

```bash
gh pr checkout <numero>
# resolva, commite, push
```

## 7. Depois

- Comente na issue o que foi corrigido e em qual versão.
- Pergunte se cabe um ADR ou um teste de integração que teria pegado isso antes.
- Se houve rollback no caminho, registre em [rollback.md](rollback.md).

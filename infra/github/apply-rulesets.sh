#!/usr/bin/env bash
#
# Aplica a proteção do repositório a partir dos JSON versionados em
# infra/github/rulesets/. Idempotente: cria o ruleset na primeira execução e
# atualiza nas seguintes, comparando pelo nome.
#
# Uso:
#   make gh-protect                  # aplica
#   make gh-protect-dry              # mostra o que faria, sem alterar nada
#   REPO=outro/repo ./apply-rulesets.sh
#   ./apply-rulesets.sh --solo       # ver "MODO SOLO" abaixo
#
# MODO SOLO
#   main exige 1 aprovação de CODEOWNERS. O GitHub não deixa ninguém aprovar o
#   próprio PR, então, num repositório com um único mantenedor, essa regra
#   trava todo merge em main — inclusive o PR de release do release-please.
#   --solo zera a exigência de aprovação em main e mantém todo o resto
#   (PR obrigatório, ci-ok verde, sem force push, sem deleção).
#   Remova o --solo no dia em que existir um segundo mantenedor.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

REPO="${REPO:-leandrojtv/Bolsiq}"
DRY_RUN=0
SOLO=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --solo)    SOLO=1 ;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

for cmd in gh jq; do
  command -v "$cmd" >/dev/null || { echo "Falta o comando '$cmd'." >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Rode 'gh auth login' primeiro." >&2; exit 1; }

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
aviso(){ printf '\033[1;33m  !!\033[0m %s\n' "$*"; }

executar() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# 1. Configurações do repositório que não são ruleset
# ---------------------------------------------------------------------------
info "Configurações do repositório $REPO"

# allowed_merge_methods dos rulesets só funciona se o método estiver habilitado
# no repositório. develop usa squash, main usa merge commit. Rebase fica fora.
executar gh repo edit "$REPO" \
  --enable-merge-commit \
  --enable-squash-merge \
  --enable-rebase-merge=false \
  --delete-branch-on-merge \
  --enable-auto-merge=false
ok "merge commit e squash habilitados, rebase desabilitado, branch apagada após o merge"

executar gh api -X PATCH "repos/$REPO" \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  -f merge_commit_title=PR_TITLE \
  -f merge_commit_message=PR_BODY \
  --silent
ok "mensagem de merge derivada do título e corpo do PR (mantém Conventional Commits)"

# ---------------------------------------------------------------------------
# 2. Labels
# ---------------------------------------------------------------------------
info "Labels"
if [[ -f infra/github/labels.json ]]; then
  while IFS=$'\t' read -r nome cor descricao; do
    if gh label list --repo "$REPO" --limit 200 --json name --jq '.[].name' | grep -qxF "$nome"; then
      executar gh label edit "$nome" --repo "$REPO" --color "$cor" --description "$descricao"
    else
      executar gh label create "$nome" --repo "$REPO" --color "$cor" --description "$descricao"
    fi
  done < <(jq -r '.[] | [.name, .color, .description] | @tsv' infra/github/labels.json)
  ok "$(jq 'length' infra/github/labels.json) labels sincronizadas"
fi

# ---------------------------------------------------------------------------
# 3. Rulesets
# ---------------------------------------------------------------------------
info "Rulesets"

existentes="$(gh api "repos/$REPO/rulesets" --jq '[.[] | {id, name}]' 2>/dev/null || echo '[]')"

for arquivo in infra/github/rulesets/*.json; do
  nome="$(jq -r '.name' "$arquivo")"

  # Remove as chaves de comentário (_nota, _nota_*) em qualquer nível.
  corpo="$(jq 'walk(if type == "object" then with_entries(select(.key | startswith("_") | not)) else . end)' "$arquivo")"

  if [[ "$SOLO" -eq 1 && "$nome" == "main" ]]; then
    corpo="$(echo "$corpo" | jq '
      (.rules[] | select(.type == "pull_request") | .parameters.required_approving_review_count) = 0
      | (.rules[] | select(.type == "pull_request") | .parameters.require_code_owner_review) = false
      | (.rules[] | select(.type == "pull_request") | .parameters.require_last_push_approval) = false
    ')"
    aviso "modo solo: main sem exigência de aprovação humana"
  fi

  id="$(echo "$existentes" | jq -r --arg n "$nome" '.[] | select(.name == $n) | .id // empty')"

  if [[ -n "$id" ]]; then
    info "atualizando ruleset '$nome' (id $id)"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "  [dry-run] PUT repos/$REPO/rulesets/$id"
      echo "$corpo" | jq .
    else
      echo "$corpo" | gh api -X PUT "repos/$REPO/rulesets/$id" --input - --jq '.name + " atualizado"'
    fi
  else
    info "criando ruleset '$nome'"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "  [dry-run] POST repos/$REPO/rulesets"
      echo "$corpo" | jq .
    else
      echo "$corpo" | gh api -X POST "repos/$REPO/rulesets" --input - --jq '.name + " criado"'
    fi
  fi
  ok "ruleset '$nome'"
done

# ---------------------------------------------------------------------------
# 4. Environments
# ---------------------------------------------------------------------------
info "Environments"
for ambiente in staging production production-rollback; do
  executar gh api -X PUT "repos/$REPO/environments/$ambiente" --silent
  ok "environment '$ambiente'"
done
aviso "required reviewers do 'production' NÃO são configurados aqui: a aprovação"
aviso "manual é decisão humana e fica na interface do GitHub."
aviso "'production-rollback' deve ficar SEM required reviewers, senão o rollback"
aviso "automático espera aprovação com a produção quebrada."

# ---------------------------------------------------------------------------
# 5. Conferência
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" -eq 0 ]]; then
  info "Estado final"
  gh api "repos/$REPO/rulesets" \
    --jq '.[] | "  \(.name)  enforcement=\(.enforcement)  id=\(.id)"'
  echo
  info "Secrets necessários (configure os que faltarem)"
  configurados="$(gh secret list --repo "$REPO" --json name --jq '.[].name' 2>/dev/null || true)"
  for s in ANTHROPIC_API_KEY SSH_HOST SSH_USER SSH_KEY ENV_FILE RELEASE_PLEASE_TOKEN; do
    if echo "$configurados" | grep -qxF "$s"; then
      ok "$s"
    else
      aviso "$s faltando — veja docs/ci-cd.md"
    fi
  done
fi

info "Pronto."

#!/usr/bin/env bash
#
# Confere que toda action referenciada nos workflows existe de fato como tag ou
# branch no repositório de origem.
#
# O actionlint valida sintaxe e contexto, mas NÃO verifica se a versão existe:
# `uses: aquasecurity/trivy-action@0.33.1` passa no lint e falha no runner com
# "unable to resolve action". Este script fecha essa lacuna.
#
# Uso: make check-actions

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

command -v gh >/dev/null || { echo "Falta o comando 'gh'." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Rode 'gh auth login' primeiro." >&2; exit 1; }

referencias="$(grep -rhoE 'uses: [a-zA-Z0-9._-]+/[a-zA-Z0-9._/-]+@[a-zA-Z0-9._-]+' \
  .github/workflows/ .github/actions/ 2>/dev/null | sed 's/uses: //' | sort -u)"

if [[ -z "$referencias" ]]; then
  echo "Nenhuma action externa referenciada."
  exit 0
fi

total=0
falhas=0

while IFS= read -r ref; do
  total=$((total + 1))
  repo="${ref%@*}"
  tag="${ref##*@}"
  owner="$(cut -d/ -f1 <<< "$repo")"
  name="$(cut -d/ -f2 <<< "$repo")"

  if gh api "repos/$owner/$name/git/ref/tags/$tag" >/dev/null 2>&1 \
     || gh api "repos/$owner/$name/git/ref/heads/$tag" >/dev/null 2>&1; then
    printf '  \033[1;32mok\033[0m      %s\n' "$ref"
  else
    printf '  \033[1;31mFALTA\033[0m   %s\n' "$ref"
    falhas=$((falhas + 1))
  fi
done <<< "$referencias"

echo
if [[ "$falhas" -gt 0 ]]; then
  echo "$falhas de $total referência(s) não existem. Corrija antes do push."
  exit 1
fi
echo "Todas as $total referências existem."

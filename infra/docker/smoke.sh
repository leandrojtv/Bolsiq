#!/usr/bin/env bash
#
# Smoke test: bate nos endpoints de health através do Kong e falha se algum não
# responder 200 dentro do tempo limite. Usado pelo job `smoke` do CI e como
# verificação pós-deploy em staging e produção.
#
# Uso: bash smoke.sh [base_url]
#   base_url padrão: http://localhost:8000 (porta do proxy do Kong)
#
# A lista de endpoints vive em infra/docker/health-endpoints.txt (um por linha,
# comentários com #). Se o arquivo não existir, usa só o status do Kong.

set -euo pipefail

BASE="${1:-http://localhost:8000}"
TENTATIVAS="${SMOKE_RETRIES:-30}"
INTERVALO="${SMOKE_INTERVAL:-2}"

aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lista="$aqui/health-endpoints.txt"

endpoints=()
if [[ -f "$lista" ]]; then
  while IFS= read -r linha; do
    linha="${linha%%#*}"
    linha="$(echo "$linha" | xargs || true)"
    [[ -n "$linha" ]] && endpoints+=("$linha")
  done < "$lista"
fi

if [[ ${#endpoints[@]} -eq 0 ]]; then
  echo "Nenhum endpoint em health-endpoints.txt; verificando apenas o Kong."
  endpoints=("/status")
fi

falhas=0

for ep in "${endpoints[@]}"; do
  url="${BASE}${ep}"
  printf '%-50s ' "$ep"
  ok=0
  for ((i = 1; i <= TENTATIVAS; i++)); do
    codigo="$(curl -s -o /tmp/smoke-corpo -w '%{http_code}' --max-time 5 "$url" 2>/dev/null)" || codigo="000"
    if [[ "$codigo" == "200" ]]; then
      ok=1
      break
    fi
    sleep "$INTERVALO"
  done

  if [[ "$ok" -eq 1 ]]; then
    echo "200 ok (tentativa $i)"
  else
    echo "FALHOU (último código: ${codigo:-000})"
    echo "  resposta: $(head -c 300 /tmp/smoke-corpo 2>/dev/null || true)"
    falhas=$((falhas + 1))
  fi
done

if [[ "$falhas" -gt 0 ]]; then
  echo
  echo "Smoke reprovado: $falhas endpoint(s) sem resposta 200."
  exit 1
fi

echo
echo "Smoke aprovado: ${#endpoints[@]} endpoint(s) respondendo."

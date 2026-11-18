#!/usr/bin/env bash
# Regressao visual do packages/ui na imagem oficial do Playwright, como o CI.
#
# Uso: scripts/visual.sh            compara com as referencias
#      scripts/visual.sh --update   regrava as referencias
#
# Tudo acontece numa copia do repositorio dentro do container: instala, gera o
# Storybook e roda o Playwright. O node_modules da maquina nao e lido nem
# escrito; ele pode ser de outro sistema (macOS), e instalar em cima dele com
# o repositorio montado ja deixou binarios de Linux no lugar dos da maquina.
set -euo pipefail

ui="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
raiz="$(cd "$ui/../.." && pwd)"
versao="$(sed -n 's/.*"@playwright\/test": "\([0-9.]*\)".*/\1/p' "$ui/package.json")"
pnpm_versao="$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\)".*/\1/p' "$raiz/package.json")"
args=""
[[ "${1:-}" == "--update" ]] && args="--update-snapshots"

mkdir -p "$ui/tests/visual/__screenshots__" "$ui/test-results"

docker run --rm --ipc=host \
  -v "$raiz":/repo:ro \
  -v "$ui/tests/visual/__screenshots__":/saida/referencias \
  -v "$ui/test-results":/saida/resultados \
  -v bolsiq-pnpm-store:/pnpm-store \
  -e CI=1 -e npm_config_store_dir=/pnpm-store \
  "mcr.microsoft.com/playwright:v${versao}-noble" bash -c "
    set -euo pipefail
    mkdir -p /work
    tar -C /repo --exclude=node_modules --exclude=.git --exclude=.turbo \
      --exclude=storybook-static --exclude=test-results --exclude=dist -cf - . | tar -C /work -xf -
    cd /work
    # A imagem do Playwright nao traz corepack.
    npm i -g --silent pnpm@${pnpm_versao} >/dev/null
    pnpm install --frozen-lockfile --filter '@bolsiq/ui...' >/dev/null
    pnpm --filter @bolsiq/ui build-storybook >/dev/null
    status=0
    pnpm --filter @bolsiq/ui exec playwright test --reporter=list $args || status=\$?
    cp -r packages/ui/tests/visual/__screenshots__/. /saida/referencias/
    rm -rf /saida/resultados/* && cp -r packages/ui/test-results/. /saida/resultados/ 2>/dev/null || true
    exit \$status
  "

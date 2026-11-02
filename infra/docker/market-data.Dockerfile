# syntax=docker/dockerfile:1

# Imagem do market-data. A mesma imagem serve api e worker; quem decide é a
# variável ROLE (ADR 0006).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Poda do monorepo
#
# `turbo prune` monta um workspace mínimo com só o que o market-data alcança,
# e separa os package.json (out/json) do código (out/full). Isso dá a camada de
# dependências em cache sem precisar listar cada package.json à mão.
#
# A lista à mão era um erro esperando a hora: acrescentar um pacote ao
# workspace e esquecer a linha de COPY aqui produz um build que falha com
# "Cannot find module", longe da causa. Aconteceu com @bolsiq/messaging.
# ---------------------------------------------------------------------------
FROM base AS pruner
COPY . .
# `pnpm dlx` porque este estágio não tem node_modules: o turbo do workspace só
# existe depois do install, que acontece no estágio seguinte, e o install
# precisa do resultado da poda. O major acompanha o `turbo` do package.json.
RUN pnpm dlx turbo@2 prune @bolsiq/market-data --docker

# ---------------------------------------------------------------------------
# Dependências — camada separada, invalidada só quando um manifesto muda
# ---------------------------------------------------------------------------
FROM base AS deps
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
# --ignore-scripts: o build só precisa compilar TypeScript. Sem isso, o ssh2
# (dependência transitiva do testcontainers, que é só de teste) tenta compilar
# módulo nativo e enche o log de erros de gyp a cada build — erros toleráveis,
# mas que parecem falha para quem lê o log depois.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM deps AS build
COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter=@bolsiq/market-data...
# Separa só o que o serviço precisa em runtime, com as dependências de
# workspace já resolvidas.
RUN pnpm --filter=@bolsiq/market-data deploy --prod /app

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV ROLE=api
ENV PORT=3001

# Não roda como root.
RUN useradd --system --create-home --shell /usr/sbin/nologin bolsiq
WORKDIR /app

COPY --from=build --chown=bolsiq:bolsiq /app ./
# As migrations vão na imagem: o passo `migrate` do compose usa esta mesma
# imagem, então produção aplica exatamente as migrations que acompanham o
# código que vai subir.
COPY --from=build --chown=bolsiq:bolsiq /repo/packages/db-core/migrations ./node_modules/@bolsiq/db-core/migrations

USER bolsiq
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]

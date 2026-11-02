# syntax=docker/dockerfile:1

# Imagem do market-data. A mesma imagem serve api e worker; quem decide é a
# variável ROLE (ADR 0006).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Dependências — camada separada para o cache sobreviver a mudança de código
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db-core/package.json packages/db-core/
COPY services/market-data/package.json services/market-data/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
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

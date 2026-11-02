# syntax=docker/dockerfile:1

# Imagem dedicada do analytics-worker (ADR 0018).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @bolsiq/analytics-worker --docker

FROM base AS deps
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter=@bolsiq/analytics-worker...
RUN pnpm --filter=@bolsiq/analytics-worker deploy --prod /app

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3003
RUN useradd --system --create-home --shell /usr/sbin/nologin bolsiq
WORKDIR /app
COPY --from=build --chown=bolsiq:bolsiq /app ./
COPY --from=build --chown=bolsiq:bolsiq /repo/packages/analytics/migrations ./migrations
USER bolsiq
EXPOSE 3003
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3003)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

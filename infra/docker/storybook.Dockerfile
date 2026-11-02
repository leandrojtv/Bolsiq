# syntax=docker/dockerfile:1

# Storybook do packages/ui, servido como estatico. Perfil `tools` do compose:
#   docker compose -f infra/docker/compose.dev.yml --profile tools up storybook

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @bolsiq/ui --docker

FROM base AS build
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ ./
RUN pnpm --filter @bolsiq/ui build-storybook

FROM nginx:1.29-alpine AS runtime
COPY --from=build /repo/packages/ui/storybook-static /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/iframe.html || exit 1

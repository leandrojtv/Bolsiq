# syntax=docker/dockerfile:1

# Imagem do apps/web (Next.js, output standalone).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @bolsiq/web --docker

FROM base AS build
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter=@bolsiq/web...
# Toda imagem passa pela busca de chave no bundle do navegador.
RUN node apps/web/scripts/checar-bundle.mjs

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# qpdf abre o PDF com senha no envio da importacao com IA; a senha nao e gravada.
RUN apt-get update \
    && apt-get install -y --no-install-recommends qpdf \
    && rm -rf /var/lib/apt/lists/*
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN useradd --system --create-home --shell /usr/sbin/nologin bolsiq
WORKDIR /app
# standalone traz o servidor e so as dependencias que ele usa; static e public
# vao a parte, como a documentacao do Next pede.
COPY --from=build --chown=bolsiq:bolsiq /repo/apps/web/.next/standalone ./
COPY --from=build --chown=bolsiq:bolsiq /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=bolsiq:bolsiq /repo/apps/web/public ./apps/web/public
USER bolsiq
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

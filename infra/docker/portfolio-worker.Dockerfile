# syntax=docker/dockerfile:1

# Imagem do portfolio-worker: snapshot diario das carteiras, importacao com IA
# em segundo plano (ADR 0027) e migrations dos schemas `app`, `portfolio`
# (ADR 0022) e `assistant` (ADR 0024).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @bolsiq/portfolio-worker --docker

FROM base AS deps
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter=@bolsiq/portfolio-worker...
RUN pnpm --filter=@bolsiq/portfolio-worker deploy --prod /app

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3004
# Leitura da importacao com IA: pdftotext e pdftoppm (PDF que o pdf.js nao abre,
# pagina escaneada como imagem), tesseract em portugues (OCR sem modelo de visao)
# e heif-convert (foto HEIC do celular).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       poppler-utils tesseract-ocr tesseract-ocr-por libheif-examples \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --shell /usr/sbin/nologin bolsiq
WORKDIR /app
COPY --from=build --chown=bolsiq:bolsiq /app ./
COPY --from=build --chown=bolsiq:bolsiq /repo/packages/auth/migrations ./migrations/app
COPY --from=build --chown=bolsiq:bolsiq /repo/packages/portfolio/migrations ./migrations/portfolio
COPY --from=pruner --chown=bolsiq:bolsiq /repo/packages/assistant/migrations ./migrations/assistant
USER bolsiq
EXPOSE 3004
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3004)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

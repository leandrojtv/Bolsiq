# Regra 1 do CLAUDE.md: tudo roda via Docker. Nada aqui exige instalação local
# além de Docker e make — nem Node, nem pnpm, nem psql.

SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

REPO        ?= leandrojtv/Bolsiq
NODE_IMAGE  ?= node:22-bookworm-slim
COMPOSE_DEV ?= infra/docker/compose.dev.yml
COMPOSE_CI  ?= infra/docker/compose.ci.yml

# Roda um comando pnpm dentro de um container, com o repositório montado e o
# store do pnpm em volume nomeado para não reinstalar tudo a cada chamada.
# -t só quando há TTY: em CI ou sob um agente, `docker run -it` falha com
# "the input device is not a TTY".
DOCKER_TTY := $(shell test -t 0 && echo -t)

PNPM := docker run --rm -i $(DOCKER_TTY) \
	-v "$(CURDIR)":/app \
	-v bolsiq-pnpm-store:/pnpm-store \
	-w /app \
	-e CI=$${CI:-} \
	-e PNPM_HOME=/pnpm \
	-e npm_config_store_dir=/pnpm-store \
	$(NODE_IMAGE) \
	bash -lc 'corepack enable >/dev/null 2>&1 && exec pnpm "$$@"' pnpm

define exige_monorepo
	@if [ ! -f pnpm-workspace.yaml ]; then \
		echo "O monorepo ainda não existe (pnpm-workspace.yaml não encontrado)."; \
		echo "Este alvo passa a funcionar quando o workspace for criado."; \
		exit 1; \
	fi
endef

## help: lista os alvos
help:
	@echo "Alvos disponíveis:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /' | sort

# ---------------------------------------------------------------------------
# Desenvolvimento
# ---------------------------------------------------------------------------

## up: sobe o ambiente de desenvolvimento
up:
	@test -f $(COMPOSE_DEV) || { echo "Falta $(COMPOSE_DEV); será criado junto com os serviços."; exit 1; }
	docker compose -f $(COMPOSE_DEV) up -d --wait

## down: derruba o ambiente e apaga os volumes
down:
	@test -f $(COMPOSE_DEV) && docker compose -f $(COMPOSE_DEV) down -v || true

## logs: acompanha os logs do ambiente de desenvolvimento
logs:
	docker compose -f $(COMPOSE_DEV) logs -f --tail 100

## install: instala as dependências
install:
	$(call exige_monorepo)
	$(PNPM) install

# ---------------------------------------------------------------------------
# Qualidade — o que o CI roda
# ---------------------------------------------------------------------------

## lint: ESLint e Prettier
lint:
	$(call exige_monorepo)
	$(PNPM) turbo run lint
	$(PNPM) prettier --check .

## format: aplica o Prettier
format:
	$(call exige_monorepo)
	$(PNPM) prettier --write .

## typecheck: tsc em todos os pacotes
typecheck:
	$(call exige_monorepo)
	$(PNPM) turbo run typecheck

## test: testes unitários com cobertura
test:
	$(call exige_monorepo)
	$(PNPM) turbo run test:unit

## test-integration: testes de integração (Testcontainers)
test-integration:
	$(call exige_monorepo)
	@# --concurrency=1: cada suíte sobe os próprios Postgres e NATS, e uma
	@# delas derruba o broker de propósito. Paralelizar só disputa recurso.
	$(PNPM) turbo run test:integration --concurrency=1

## test-e2e: Playwright contra o compose
test-e2e:
	$(call exige_monorepo)
	$(PNPM) turbo run test:e2e

## ci: roda localmente a mesma sequência do CI
ci: lint typecheck test test-integration
	@echo "Sequência do CI concluída. Os jobs de contrato, build, smoke e e2e dependem do compose e das imagens."

# ---------------------------------------------------------------------------
# Banco
# ---------------------------------------------------------------------------

## db-generate: gera migration a partir do schema do Drizzle
db-generate:
	$(call exige_monorepo)
	$(PNPM) turbo run db:generate

## db-migrate: aplica as migrations
db-migrate:
	$(call exige_monorepo)
	$(PNPM) turbo run db:migrate

## db-reset: recria o banco de desenvolvimento do zero
db-reset:
	docker compose -f $(COMPOSE_DEV) down -v postgres
	docker compose -f $(COMPOSE_DEV) up -d --wait postgres
	$(MAKE) db-migrate

# ---------------------------------------------------------------------------
# Smoke
# ---------------------------------------------------------------------------

## docs-events: regera docs/events.md a partir dos schemas
docs-events:
	$(call exige_monorepo)
	$(PNPM) --filter @bolsiq/contracts run docs:events

## docs-events-check: confere se docs/events.md está em dia com os schemas
docs-events-check:
	$(call exige_monorepo)
	$(PNPM) --filter @bolsiq/contracts run docs:events:check

## build-image: constroi as imagens (market-data, alerts-worker e analytics-worker)
build-image:
	docker build -f infra/docker/market-data.Dockerfile -t bolsiq-market-data:$${IMAGE_TAG:-local} .
	docker build -f infra/docker/alerts-worker.Dockerfile -t bolsiq-alerts-worker:$${IMAGE_TAG:-local} .
	docker build -f infra/docker/analytics-worker.Dockerfile -t bolsiq-analytics-worker:$${IMAGE_TAG:-local} .
	docker build -f infra/docker/web.Dockerfile -t bolsiq-web:$${IMAGE_TAG:-local} .

## build-image-clean: constroi sem cache, como o CI faz
build-image-clean:
	@# O CI parte de um checkout limpo. Construir com cache local pode passar
	@# por motivo errado — já passou, quando o node_modules da máquina entrava
	@# no contexto e levava o turbo de carona.
	docker build --no-cache -f infra/docker/market-data.Dockerfile -t bolsiq-market-data:$${IMAGE_TAG:-local} .

# ---------------------------------------------------------------------------
# Ambiente local completo — para testar na mão
# ---------------------------------------------------------------------------

## dev-up: constroi a imagem e sobe tudo (Postgres, NATS, api, worker) na 8000
dev-up: build-image
	IMAGE_TAG=$${IMAGE_TAG:-local} docker compose -f $(COMPOSE_CI) up -d --wait --wait-timeout 180
	@echo
	@echo "  App      http://localhost:3000"
	@echo "  API      http://localhost:8000/v1/health"
	@echo "  Swagger  http://localhost:8000/docs"
	@echo "  OpenAPI  http://localhost:8000/v1/openapi.json"
	@echo "  Stream   ws://localhost:8000/v1/stream"
	@echo "  Página   infra/dev/teste-stream.html  (abra no navegador)"
	@echo
	@echo "  Publicar cotação:  make dev-cotacao TICKER=PETR4 PRECO=38.42"
	@echo
	@echo "  Caixa de e-mail:  http://localhost:8025"
	@echo "  Carga histórica:  make backfill FROM=2024"

## backfill: carga histórica desde FROM (COTAHIST, CVM e BCB) no ambiente local
backfill:
	@test -n "$(FROM)" || { echo "uso: make backfill FROM=2024"; exit 1; }
	docker compose -f $(COMPOSE_CI) run --rm --no-deps market-data-worker node dist/backfill.js $(FROM)

## dev-down: derruba o ambiente local e apaga os volumes
dev-down:
	docker compose -f $(COMPOSE_CI) down -v

## dev-logs: acompanha os logs do market-data
dev-logs:
	docker compose -f $(COMPOSE_CI) logs -f --tail 50 market-data market-data-worker analytics-worker

## dev-cotacao: publica uma cotação no outbox (TICKER=, PRECO=, VARIACAO=)
dev-cotacao:
	@test -n "$(TICKER)" || { echo "uso: make dev-cotacao TICKER=PETR4 PRECO=38.42"; exit 1; }
	@docker compose -f $(COMPOSE_CI) exec -T postgres psql -U bolsiq -d bolsiq -v ON_ERROR_STOP=1 -c 		"INSERT INTO market_data.outbox (id, event_name, payload, occurred_at, producer) VALUES (gen_random_uuid()::text, 'marketdata.quote.updated.v1', jsonb_build_object('ticker', '$(TICKER)', 'price', '$(or $(PRECO),38.42)', 'change', '$(or $(VARIACAO),0.10)', 'ts', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')), now(), 'dev');"
	@echo "cotação de $(TICKER) no outbox; o publisher a envia em até 1s"

## storybook: sobe o Storybook do packages/ui em http://localhost:6006 (perfil tools)
storybook:
	docker compose -f $(COMPOSE_DEV) --profile tools up -d --build --wait storybook
	@echo "  Storybook  http://localhost:6006"

## ui-visual: regressao visual do packages/ui na imagem do Playwright (como o CI)
ui-visual:
	bash packages/ui/scripts/visual.sh

## ui-visual-update: regrava as referencias visuais depois de mudanca intencional
ui-visual-update:
	bash packages/ui/scripts/visual.sh --update

## smoke: bate nos endpoints de health via Kong
smoke:
	bash infra/docker/smoke.sh $${BASE_URL:-http://localhost:8000}

# ---------------------------------------------------------------------------
# GitHub — proteção como código
# ---------------------------------------------------------------------------

## gh-protect: aplica rulesets, labels e environments
gh-protect:
	REPO=$(REPO) bash infra/github/apply-rulesets.sh

## gh-protect-dry: mostra o que o gh-protect faria, sem alterar nada
gh-protect-dry:
	REPO=$(REPO) bash infra/github/apply-rulesets.sh --dry-run

## gh-protect-solo: igual ao gh-protect, mas sem exigir aprovação em main
gh-protect-solo:
	REPO=$(REPO) bash infra/github/apply-rulesets.sh --solo

## gh-status: mostra rulesets e secrets configurados
gh-status:
	@echo "== rulesets =="
	@gh api repos/$(REPO)/rulesets --jq '.[] | "  \(.name)  \(.enforcement)"' || echo "  nenhum"
	@echo "== secrets =="
	@gh secret list --repo $(REPO) || true
	@echo "== environments =="
	@gh api repos/$(REPO)/environments --jq '.environments[]? | "  \(.name)"' || echo "  nenhum"

# ---------------------------------------------------------------------------
# Verificações locais que não dependem do monorepo
# ---------------------------------------------------------------------------

## check-workflows: valida a sintaxe dos workflows com actionlint
check-workflows:
	docker run --rm -v "$(CURDIR)":/repo -w /repo rhysd/actionlint:latest -color

## check-actions: confere que toda action referenciada existe
check-actions:
	bash infra/github/check-actions.sh

## check-links: procura links quebrados no Markdown
check-links:
	docker run --rm -v "$(CURDIR)":/input -w /input lycheeverse/lychee --no-progress --config lychee.toml './**/*.md'

## check-secrets: procura segredos no código e no histórico
check-secrets:
	docker run --rm -v "$(CURDIR)":/repo zricethezav/gitleaks:latest detect --source=/repo --config=/repo/.gitleaks.toml --verbose

## check-deps: vulnerabilidades HIGH e CRITICAL nas dependencias (Trivy, como o CI)
check-deps:
	docker run --rm -v "$(CURDIR)":/repo -w /repo aquasec/trivy:latest fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --quiet .

## check: todas as verificações que já funcionam sem o monorepo
check: check-workflows check-actions check-links check-secrets check-deps

.PHONY: help up down logs install lint format typecheck test test-integration \
        test-e2e ci db-generate db-migrate db-reset smoke gh-protect \
        gh-protect-dry gh-protect-solo gh-status check-workflows check-actions \
        check-links check-secrets check

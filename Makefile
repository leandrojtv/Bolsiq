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
PNPM := docker run --rm -it \
	-v "$(CURDIR)":/app \
	-v bolsiq-pnpm-store:/pnpm-store \
	-w /app \
	-e CI=$${CI:-} \
	-e PNPM_HOME=/pnpm \
	-e npm_config_store_dir=/pnpm-store \
	$(NODE_IMAGE) \
	bash -lc 'corepack enable >/dev/null 2>&1 && exec pnpm'

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
	$(PNPM) turbo run test:integration

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
	docker run --rm -v "$(CURDIR)":/input lycheeverse/lychee --no-progress --exclude-path node_modules './**/*.md'

## check-secrets: procura segredos no código e no histórico
check-secrets:
	docker run --rm -v "$(CURDIR)":/repo zricethezav/gitleaks:latest detect --source=/repo --verbose

## check: todas as verificações que já funcionam sem o monorepo
check: check-workflows check-actions check-links check-secrets

.PHONY: help up down logs install lint format typecheck test test-integration \
        test-e2e ci db-generate db-migrate db-reset smoke gh-protect \
        gh-protect-dry gh-protect-solo gh-status check-workflows check-actions \
        check-links check-secrets check

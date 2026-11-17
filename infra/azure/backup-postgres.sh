#!/usr/bin/env bash
#
# Backup diário do Postgres de produção (ADR 0030).
#
# Roda no host, pelo cron do usuário bolsiq (instalado pelo setup-vm.sh e
# enviado pelo deploy.yml). Gera um pg_dump em formato custom (já comprimido)
# dentro do container e guarda em ~/backups, mantendo os últimos 7 dias.
#
# Uso: bash backup-postgres.sh [diretorio_do_compose] [diretorio_de_backup]
# Restauração: docs/runbooks/infra-azure.md.

set -euo pipefail

COMPOSE_DIR="${1:-$HOME/bolsiq}"
DESTINO="${2:-$HOME/backups}"
RETENCAO_DIAS="${BACKUP_RETENTION_DAYS:-7}"

cd "$COMPOSE_DIR"
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

arquivo="$DESTINO/bolsiq-$(date -u +%Y%m%dT%H%M%SZ).dump"
parcial="$arquivo.parcial"

# O usuário e o banco vêm do próprio container: nada de segredo neste script.
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "${POSTGRES_DB:-bolsiq}" --format=custom --compress=9' \
  > "$parcial"

# Dump vazio ou truncado não pode substituir os bons na rotação.
if [[ ! -s "$parcial" ]]; then
  rm -f "$parcial"
  echo "backup falhou: arquivo vazio" >&2
  exit 1
fi

mv "$parcial" "$arquivo"
chmod 600 "$arquivo"
find "$DESTINO" -maxdepth 1 -name 'bolsiq-*.dump' -mtime +"$((RETENCAO_DIAS - 1))" -delete
find "$DESTINO" -maxdepth 1 -name '*.parcial' -delete

echo "backup ok: $arquivo ($(du -h "$arquivo" | cut -f1))"

#!/usr/bin/env bash
# Резервная копия PostgreSQL: pg_dump → age → локальный каталог + S3 (KI-667).
#
# Скрипт — единственный источник правды для процедуры из docs/development/PRODUCTION.md § 8.
# Запускается cron'ом/systemd-timer на хосте; секреты берутся из .env хоста,
# в репозитории их нет (RULES 5.1).
#
# Обязательные переменные окружения:
#   POSTGRES_USER, POSTGRES_DB     — берутся из .env проекта (загружается ниже)
#   AGE_PUBLIC_KEY                 — публичный ключ age (по умолчанию /etc/age/backup.pub)
#   BACKUP_S3_BUCKET               — S3-бакет бэкапов (Selectel)
# Необязательные:
#   BACKUP_DIR                     — локальный каталог (по умолчанию /var/backups/workflow-builder)
#   BACKUP_S3_ENDPOINT             — endpoint S3 (для aws/mc)
#   BACKUP_S3_PREFIX               — префикс ключей (по умолчанию workflow-builder)
#   BACKUP_RETENTION_DAYS          — retention (по умолчанию 30)
#   BACKUP_S3_CMD                  — `aws`, `mc` или `none` (по умолчанию aws)
#   TEXTFILE_DIR                   — каталог node_exporter textfile (метрика свежести)
#   COMPOSE_FILES                  — список `-f ...` через пробел
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/workflow-builder}"
AGE_PUBLIC_KEY="${AGE_PUBLIC_KEY:-/etc/age/backup.pub}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-workflow-builder}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_S3_CMD="${BACKUP_S3_CMD:-aws}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/node_exporter/textfile_collector}"
COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.prod.yml docker-compose.prod.override.yml}"
PROJECT_DIR="${PROJECT_DIR:-/srv/workflow-builder}"

log() { printf '[backup-db] %s %s\n' "$(TZ=Europe/Moscow date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }

if [[ -z "$BACKUP_S3_BUCKET" ]]; then
  log 'BACKUP_S3_BUCKET не задан: локальный дамп не является бэкапом (PRODUCTION § 8)'
  exit 2
fi
if [[ ! -r "$AGE_PUBLIC_KEY" ]]; then
  log "нет ключа age: $AGE_PUBLIC_KEY"
  exit 2
fi
for tool in docker age; do
  command -v "$tool" >/dev/null || { log "не найден инструмент: $tool"; exit 2; }
done
if [[ "$BACKUP_S3_CMD" != 'none' ]] && ! command -v "$BACKUP_S3_CMD" >/dev/null; then
  log "не найден инструмент загрузки в S3: $BACKUP_S3_CMD"
  exit 2
fi

cd "$PROJECT_DIR"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

STAMP="$(TZ=Europe/Moscow date +%Y%m%dT%H%M%S)"
TMP_FILE="$BACKUP_DIR/.db-${STAMP}.dump.age.part"
FINAL_FILE="$BACKUP_DIR/db-${STAMP}.dump.age"
mkdir -p "$BACKUP_DIR"

COMPOSE_ARGS=()
for file in $COMPOSE_FILES; do COMPOSE_ARGS+=(-f "$file"); done

log 'снимаю pg_dump → age'
if ! docker compose "${COMPOSE_ARGS[@]}" exec -T db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
    | age -R "$AGE_PUBLIC_KEY" > "$TMP_FILE"; then
  log 'pg_dump/age завершились с ошибкой'
  rm -f "$TMP_FILE"
  exit 1
fi

if [[ ! -s "$TMP_FILE" ]]; then
  log 'дамп пустой — отменяю публикацию'
  rm -f "$TMP_FILE"
  exit 1
fi
mv "$TMP_FILE" "$FINAL_FILE"
log "дамп готов: $FINAL_FILE ($(stat -c%s "$FINAL_FILE") байт)"

if [[ "$BACKUP_S3_CMD" != 'none' ]]; then
  log 'загружаю дамп в S3'
  case "$BACKUP_S3_CMD" in
    aws)
      AWS_ARGS=(s3 cp "$FINAL_FILE" "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/$(basename "$FINAL_FILE")")
      if [[ -n "$BACKUP_S3_ENDPOINT" ]]; then
        AWS_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
      fi
      aws "${AWS_ARGS[@]}"
      ;;
    mc)
      mc cp "$FINAL_FILE" "${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/$(basename "$FINAL_FILE")"
      ;;
  esac
  log 'offsite-копия загружена'
fi

# node_exporter textfile: свежесть последнего успешного бэкапа (алерт > 26 ч).
if [[ -d "$TEXTFILE_DIR" ]]; then
  printf '# HELP backup_last_success_timestamp Время последнего успешного бэкапа БД (unix, сек).\n# TYPE backup_last_success_timestamp gauge\nbackup_last_success_timestamp %s\n' \
    "$(date +%s)" > "$TEXTFILE_DIR/backup-db.prom"
fi

find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump.age' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
log 'готово'

#!/usr/bin/env bash
# Учебное восстановление бэкапа в изолированный Postgres (KI-667).
#
# Никогда не трогает прод: поднимает временный контейнер `postgres:17`,
# восстанавливает свежий дамп и проверяет целостность. Результат пишется
# в метрику `backup_restore_drill_timestamp` (node_exporter textfile).
#
# Переменные: см. scripts/backup-db.sh (BACKUP_S3_*, BACKUP_DIR, AGE_PUBLIC_KEY, ...).
# Дополнительно: AGE_PRIVATE_KEY (по умолчанию /etc/age/backup.key),
#   DRILL_IMAGE (по умолчанию pgvector/pgvector:pg17),
#   DRILL_DB/DRILL_USER (по умолчанию workflow).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/workflow-builder}"
AGE_PUBLIC_KEY="${AGE_PUBLIC_KEY:-/etc/age/backup.pub}"
AGE_PRIVATE_KEY="${AGE_PRIVATE_KEY:-/etc/age/backup.key}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-workflow-builder}"
BACKUP_S3_CMD="${BACKUP_S3_CMD:-aws}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/node_exporter/textfile_collector}"
DRILL_IMAGE="${DRILL_IMAGE:-pgvector/pgvector:pg17}"
DRILL_DB="${DRILL_DB:-workflow}"
DRILL_USER="${DRILL_USER:-workflow}"
DRILL_CONTAINER="wb-restore-drill-$$"

log() { printf '[restore-drill] %s %s\n' "$(TZ=Europe/Moscow date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }

cleanup() {
  docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null || { log 'не найден docker'; exit 2; }
command -v age >/dev/null || { log 'не найден age'; exit 2; }
[[ -r "$AGE_PRIVATE_KEY" ]] || { log "нет приватного ключа age: $AGE_PRIVATE_KEY"; exit 2; }

LATEST="$(find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump.age' -type f -printf '%f\n' | sort | tail -n 1)"
if [[ -z "$LATEST" && "$BACKUP_S3_CMD" != 'none' && -n "$BACKUP_S3_BUCKET" ]]; then
  log 'локального дампа нет — пробую скачать свежий из S3'
  mkdir -p "$BACKUP_DIR"
  case "$BACKUP_S3_CMD" in
    aws)
      AWS_ARGS=(s3 sync "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/" "$BACKUP_DIR/" --exclude '*' --include 'db-*.dump.age')
      [[ -n "$BACKUP_S3_ENDPOINT" ]] && AWS_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
      aws "${AWS_ARGS[@]}"
      ;;
    mc) mc cp "${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/db-*.dump.age" "$BACKUP_DIR/" ;;
  esac
  LATEST="$(find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump.age' -type f -printf '%f\n' | sort | tail -n 1)"
fi
[[ -n "$LATEST" ]] || { log 'не найден ни один дамп'; exit 1; }
log "проверяю дамп: $LATEST"

#age -d проверяет и шифротекст, и целостность (MAC) перед восстановлением.
age -d -i "$AGE_PRIVATE_KEY" "$BACKUP_DIR/$LATEST" > "$BACKUP_DIR/.drill.dump"

log 'поднимаю временный Postgres'
docker run -d --name "$DRILL_CONTAINER" \
  -e "POSTGRES_DB=$DRILL_DB" \
  -e "POSTGRES_USER=$DRILL_USER" \
  -e 'POSTGRES_PASSWORD=drill-only' \
  "$DRILL_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$DRILL_CONTAINER" pg_isready -U "$DRILL_USER" -d "$DRILL_DB" >/dev/null 2>&1; then break; fi
  sleep 1
done

log 'восстанавливаю дамп'
docker exec -i "$DRILL_CONTAINER" \
  pg_restore -U "$DRILL_USER" -d "$DRILL_DB" --clean --if-exists --no-owner \
  < "$BACKUP_DIR/.drill.dump"

# Минимальная проверка: таблицы на месте, базовые выборки идут.
TABLES="$(docker exec "$DRILL_CONTAINER" psql -U "$DRILL_USER" -d "$DRILL_DB" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [[ "${TABLES:-0}" -lt 1 ]]; then
  log 'в восстановленной БД нет таблиц'
  exit 1
fi
docker exec "$DRILL_CONTAINER" psql -U "$DRILL_USER" -d "$DRILL_DB" -Atqc \
  'SELECT 1 FROM workflow_runs LIMIT 1' >/dev/null 2>&1 || log 'workflow_runs пуста или отсутствует'

rm -f "$BACKUP_DIR/.drill.dump"
if [[ -d "$TEXTFILE_DIR" ]]; then
  printf '# HELP backup_restore_drill_timestamp Время последнего успешного учебного восстановления.\n# TYPE backup_restore_drill_timestamp gauge\nbackup_restore_drill_timestamp %s\n' \
    "$(date +%s)" > "$TEXTFILE_DIR/backup-drill.prom"
fi
log "успешно: таблиц=$TABLES, дамп=$LATEST"

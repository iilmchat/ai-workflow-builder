#!/bin/sh
# Entrypoint production-образа.
#
# `set -e` обязателен: без него упавшая миграция (например, БД ещё не готова)
# не остановила бы скрипт, и приложение стартовало бы на несогласованной схеме.
set -e

echo "Running migrations..."
node dist/migrate.js

echo "Starting application..."
# `exec` заменяет PID 1 shell'ом на node: SIGTERM от `docker stop` доходит до
# приложения, и enableShutdownHooks() успевает закрыть pg-пул и BullMQ
# (RULES 4.12), вместо принудительного kill через 10 секунд.
exec node dist/main.js

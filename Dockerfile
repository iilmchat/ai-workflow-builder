# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1 — builder: ставим зависимости и собираем backend + frontend.
# =============================================================================
FROM node:22-alpine AS builder

# Версия pnpm зафиксирована по `packageManager` в package.json: мажор должен
# совпадать с pnpm-lock.yaml, иначе `--frozen-lockfile` может ругаться на
# формат lockfile.
RUN npm install -g pnpm@12.11.2 --no-fund --no-audit

# В контексте нет .git (исключён .dockerignore), а `pnpm install` выполняет
# `prepare: husky`. Без HUSKY=0 husky пытается поставить git-хуки и падает.
ENV HUSKY=0

WORKDIR /app

# Манифесты и lockfile — отдельным слоем: изменения в src/ не инвалидируют
# установку зависимостей. web/ — самостоятельный проект со своим lockfile
# (корневой pnpm-workspace.yaml без `packages`), поэтому install'им его отдельно.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/pnpm-lock.yaml ./web/

RUN pnpm install --frozen-lockfile
RUN pnpm --dir web install --frozen-lockfile

# Исходники. .dockerignore вырезает node_modules, dist, web/dist, .env, .git.
COPY . .

# Backend: `nest build` (tsconfig.build.json, rootDir=src) → dist/main.js.
# `migrate.ts` лежит в корне, вне src/, и в nest build не попадает — его
# компилируем отдельным tsconfig.migrate.json → dist/migrate.js, который
# запускает docker-entrypoint.sh.
RUN pnpm build && pnpm build:migrate

# Frontend: `tsc -b && vite build` → web/dist (base="/").
RUN pnpm --dir web build

# В runner нужны только production-зависимости: nest cli, typescript, vite,
# vitest и прочие devDependencies там не используются. pnpm prune сохраняет
# структуру node_modules (symlinks в .pnpm), поэтому каталог можно копировать.
RUN pnpm prune --prod

# =============================================================================
# Stage 2 — runner: только runtime-артефакты, непривилегированный пользователь.
# =============================================================================
FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# dist/ уже содержит main.js и migrate.js (см. build:migrate выше).
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/web/dist ./web/dist
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
# nest build не копирует .json-ассеты (KI-289), а TemplateLoaderService ищет их
# в `<repo>/src/templates` как фолбэк — без этого каталога GET /templates в
# контейнере вернул бы пустой список.
COPY --from=builder --chown=node:node /app/src/templates ./src/templates
COPY --from=builder --chown=node:node /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=node:node /app/docker-entrypoint.sh ./docker-entrypoint.sh

# MEDIA_STORAGE_BACKEND=local пишет в /app/data/media (см. .env.example).
# Каталог создаём заранее и отдаём node: примонтированный volume наследует
# владельца, и приложение не падает с EACCES.
RUN mkdir -p /app/data \
    && chown -R node:node /app/data \
    && chmod +x /app/docker-entrypoint.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]

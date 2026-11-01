## [0.11.1] — 2026-10-19

**Patch-релиз: отключение внутренних ретраев SDK, fallback `image_tool` и
OpenAI Images `applyToolAsync`.**

### Fixed

- **KI-500: двойной retry SDK + движок** ([отчёт](development/reports/v0.11.1/S1-hardening.md)):
  OpenAI-совместимый и Anthropic-провайдеры создают SDK-клиенты с
  `maxRetries: 0`; повторы 429/5xx выполняет только движок
  (`NODE_RETRY_MAX_ATTEMPTS`), поэтому до 9 платных upstream-вызовов на узел
  больше не возникает. Тесты фиксируют опции конструктора и ровно N попыток
  движка; smoke с локальным upstream 429 — 1 HTTP-запрос на провайдер.
- **KI-418: `image_tool` — операции без модели** ([отчёт](development/reports/v0.11.1/S1-hardening.md)):
  `upscale` подтверждён fallback-цепочкой FAL `clarity-upscaler` → Replicate
  `real-esrgan`; `chromakey` скрыт из UI (`UI_IMAGE_TOOL_OPERATIONS`), потому
  что ни один каталог не объявляет модель хромакея. Старые workflow с
  `chromakey` открываются с пометкой «недоступно», без молчаливой подмены
  операции (KI-069).
- **KI-380: OpenAI Images — `applyToolAsync` через `/v1/images/edits`**
  ([отчёт](development/reports/v0.11.1/S2-openai-images.md)):
  провайдер скачивает входное изображение в буфер (лимит 25 МБ, PNG/JPEG/WebP),
  собирает `multipart/form-data` с `image`, `prompt`, `model` и параметрами
  операции и разбирает ответ `url`/`b64_json` тем же `toTaskResult`, что и
  генерацию. Поддержаны `upscale` и `bg_removal`; остальные операции и
  `dall-e-3` отвергаются до платного запроса. Идемпотентность — по
  `idempotencyKey`.

### Changed

- **Релизная подготовка v0.11.1 (S17)** ([отчёт](development/reports/v0.11.1/S17-release.md)):
  `package.json`/`web/package.json` → `0.11.1`; `[Unreleased]` переименован в
  `[0.11.1] — 2026-10-19`, сверху добавлена пустая секция; README/docs README,
  USER_GUIDE, MANUAL_TESTING_GUIDE и RELEASES синхронизированы по метрикам
  (1439 backend / 419 frontend, 513 KI, 0 Open High); сборка web очищена от
  предупреждения JSON-import.

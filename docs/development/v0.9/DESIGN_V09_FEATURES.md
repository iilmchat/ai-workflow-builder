# DESIGN v0.9 — Медиа, состояние, агенты

**Файл:** `docs/development/v0.9/DESIGN_V09_FEATURES.md`
**Версия:** 0.1 (draft)
**Дата:** 2026-10-16
**Статус:** Draft (на ревью)
**Закрывает (Fixed):** KI-196 (частично), KI-128, KI-105 (остаток),
KI-048, KI-067, KI-232, KI-055, KI-150
**Связанные:** KI-352, KI-360 (перспектива), KI-008 (code-split)
**RULES:** 2.5, 2.14

---

## 1. Контекст

**Точка старта.** v0.8.5 (2026-10-16). 348 KI: Fixed 136 · Open 203.
Backend 570+6 тестов, frontend 197. CI 2 job зелёный.

**Что умеет продукт сейчас:** визуальный редактор LLM-workflow
(React Flow + Zustand); 6 LLM-провайдеров + LM Studio; media
CreativeLab (57 IMAGE-моделей); Auth (JWT + refresh), Share (публичная
read-only), Export/Import/Templates, Sub-workflows; полный цикл
«нарисовал → сохранил → запустил → LLM/media выполнил → результат в
узле»; **15 типов узлов** (text, llm, image_generation, comment, http,
condition, output, compare, sub_workflow + встроенные).

**Gap-анализ vs GPTunnel / n8n / ComfyUI:**

| Категория | Gap | Приоритет |
|---|---|---|
| Media-инструменты | upscale, bg-removal, chromakey, trim, lipsync (image-to-image) | 🟠 High |
| Video / Audio / Music | text-to-video, TTS, music — 0 узлов | 🟠 High |
| Vector DB / Memory | нет состояния между запусками, нет RAG | 🟠 High |
| Agent | LLM одношаговый; нет tool-calling loop | 🟠 High |
| Cost budget | нет предохранителя по стоимости | 🟠 High |
| Condition sandbox | MVP-DSL без произвольного JS | 🟡 Medium |
| Share-участники | только публичная ссылка | 🟡 Medium |
| Image providers | только CreativeLab | 🟡 Medium |
| Observability | нет OTel, rate limit | 🟢 Low |

**Продуктовые сценарии v0.9:**
1. **Мультимодальные пайплайны:** текст → LLM → image → upscale → video.
2. **RAG-пайплайны:** документ → chunk → embed → vector_upsert → query → LLM.
3. **Agent-пайплайны:** LLM + tools (http, vector, code_eval) → финальный ответ.

---

## 2. Ключевое архитектурное решение

**Расширяем, не переписываем.** 9 принципов:

**2.1 Discriminated union `NodeData`.** Новые типы — optional-ветки.
~10 новых типов v0.9: `image_tool`, `video_generation`,
`audio_generation`, `music_generation`, `vector_upsert`, `vector_query`,
`memory_read`, `memory_write`, `agent` + возможные подтипы. Старые
workflow работают; `nodeDataFromApi` переносит новые поля.

**2.2 `NODE_REGISTRY` — единая точка.** RULES 1.15. Новые категории:
`media_tools`, `media_generation`, `state`, `agent`.

**2.3 `capabilities.externalState` — активируется.** Задел из v0.7.
В v0.9: `true` для vector/memory/agent. Влияет на UI (предупреждение),
валидатор (без настроенного хранилища — refuse), миграции (коллекции по
требованию).

**2.4 `IMediaProvider` — расширяем.** Добавить `kind: 'IMAGE' | 'VIDEO'
| 'AUDIO' | 'MUSIC' | '3D' | 'TOOL'`. Для `TOOL` — метод
`applyToolAsync(input, tool, params)` возвращает результат без poll.
CreativeLab API поддерживает. Новые провайдеры: Replicate (R7.3), FAL
(R7.3), OpenAI Images (R7.3), ElevenLabs (R7.2).

**2.5 Vector DB — pgvector в текущей PostgreSQL 17.** Extension
`vector`, таблица `workflow_vectors (id, workflow_id, collection,
embedding vector(1536), content jsonb, metadata jsonb, created_at)`,
индекс HNSW. Эмбеддинги — OpenAI `text-embedding-3-small` через
`ILlmProvider.embedAsync` (расширение). **KI-360 (перспектива):** вынос
в отдельный сервис (Qdrant/Weaviate), если >10M vectors или >100 QPS.

**2.6 Cost budget — first-class в R7.1, не в R7.7.** KI-048 вводится с
первым media-инструментом. Env `WORKFLOW_RUN_MAX_COST_USD` (default 5) +
`WORKFLOW_RUN_MAX_COST_RUB` (default 500). Перед вызовом провайдера —
проверка `accumulated + estimate > budget` → узел `failed` с
`error='Budget exceeded'`. UI — индикатор прогресса в TopBar.
**Industry best practice:** OpenAI Batch API — hard cap; Stripe/Twilio —
per-request warning + graceful degradation; **мы: hard cap** (безопаснее
для платных media).

**2.7 Agent loop — свой, не LangChain.** ~300 строк TypeScript. Прямой
вызов наших `ILlmProvider`. `AgentStep` discriminated union. `Tool`
interface с `name` + `description` + Zod input schema. Базовый набор:
`http_request`, `vector_query`, `vector_upsert`, `memory_read`,
`memory_write`, `code_eval` (WASM из R7.5), `llm_call`. Обоснование —
см. § 7.4. **Перспектива v0.10:** MCP adapter (Playwright/Puppeteer/
filesystem) — открытый стандарт Anthropic, легче LangChain.

**2.8 Condition sandbox — QuickJS-WASM, не isolated-vm.** Работает на
Windows + Linux без пересборки (native build toolchain не нужен).
Figma/Cloudflare/Shopify — доказанная модель. Ограничения: timeout
100 мс, memory 16 МБ, allowlist глобалов. Обратная совместимость с
MVP-DSL. Обоснование — см. § 7.3.

**2.9 Reasoning cache tokens — нормализация для всех
OpenAI-совместимых.** `LlmUsage.cacheReadTokens` +
`cacheCreationTokens`. Anthropic — `cache_control: ephemeral` при
systemPrompt > 1024 (по флагу `data.promptCache=true`, не по умолчанию).
`MODEL_PRICING.cacheRead` / `cacheCreation`. Новые колонки
`node_runs.cache_read_tokens` / `cache_creation_tokens`. UI — «экономия
$X». Yandex — «кэш недоступен» (честно). Обоснование — см. § 7.5.

---

## 3. Технические срезы

### 3.1 R7.1 — Media-инструменты (image-to-image)

**Закрывает:** KI-196 (частично). **~6 ч.**

**Новый узел:** `image_tool` с полем `operation: 'upscale' | 'bg_removal'
| 'chromakey' | 'trim' | 'lipsync'`.

    interface ImageToolNodeData {
      kind: 'image_tool';
      operation: ImageToolOperation;   // 5 значений выше
      model: string;                    // id из GET /media/models?type=TOOL
      inputUrl?: string;                // fallback, если нет связи
      params?: Record<string, unknown>; // параметры конкретной операции
    }

**Backend:** `MediaNodeExecutor` расширяется — `kind='image_tool'`
использует `IMediaProvider.applyToolAsync(input, tool, params)` (новый
метод). CreativeLab поддерживает операции через тот же `/api/v2/media`.
Ответ — `{ resultUrls: [{ url }], costRub, tokensIn? }`.

**Frontend:** компонент `ImageToolNode` — селект операции (5 значений),
селект модели (фильтр `output: 'image'`), preview входа (thumbnail из
связи). Плейсхолдер выхода — `<img>`.

**Cost budget — вводится здесь (KI-048).** Env:
- `WORKFLOW_RUN_MAX_COST_USD` (default `5`)
- `WORKFLOW_RUN_MAX_COST_RUB` (default `500`)
- `WORKFLOW_RUN_BUDGET_MODE` (`hard` | `soft`, default `hard`)

Проверка **перед** вызовом провайдера: `estimatedCost + accumulated >
budget` → узел `failed` с `error='Budget exceeded (estimated: $X,
remaining: $Y)'`. UI — прогресс-бар в TopBar (`data-run-budget`),
тултип с цифрами.

**i18n:** 5 ключей операции + 4 бюджет-сообщения (`budget.exceeded`,
`budget.warning`, `budget.remaining`, `budget.label`).

**Тесты:** 6+ юнит (executor + budget check), 1 integration (upscale
через мок-провайдер), CDP-смоук (узел с реальным изображением).

**Env:** `CREATIVELAB_TOOL_TIMEOUT_MS=120_000` (upscale/lipsync долгие).

---

### 3.2 R7.2 — Media-generation (video / audio / music)

**Закрывает:** KI-105 (остаток). **~8 ч.**

**Три новых узла:**

    interface VideoGenNodeData {
      kind: 'video_generation';
      model: string;
      prompt?: string;
      imageUrl?: string;      // опционально: image-to-video
      durationSec?: number;   // 3–10
      aspectRatio?: string;
    }

    interface AudioGenNodeData {
      kind: 'audio_generation';
      model: string;
      text?: string;          // TTS
      voiceId?: string;
      speed?: number;         // 0.5–2.0
    }

    interface MusicGenNodeData {
      kind: 'music_generation';
      model: string;
      prompt?: string;
      durationSec?: number;   // 15–120
      genre?: string;
    }

**Backend:** `MediaNodeExecutor` расширяется на 3 новых `kind`.
CreativeLab предоставляет VIDEO / AUDIO / MUSIC через тот же API.
Дополнительные провайдеры (R7.3): **ElevenLabs** (TTS — industry
standard), **Suno API** (music, опционально).

**Frontend:** 3 компонента. Video — `<video controls>` в узле (с
ограничением `max-height`), Audio — `<audio controls>`, Music — то же.

**Кэш media-models — расширяется:** `GET /media/models?type=VIDEO|AUDIO
|MUSIC|3D` (уже есть в API, но UI не запрашивал).

**Cost budget — уже введён в R7.1, переиспользуется.** Video =
$0.5–5 → hard cap критичен.

**Тесты:** 6+ юнит, 3 integration (видео / аудио / музыка через мок),
CDP-смоук каждого.

**Env:** `CREATIVELAB_MEDIA_TIMEOUT_MS=600_000` (10 мин на video).

# DESIGN v0.9 — Медиа, состояние, агенты

**Файл:** `docs/development/v0.9/DESIGN_V09_FEATURES.md`
**Версия:** 1.0 (released)
**Дата:** 2026-10-16
**Статус:** Released (v0.9.0, 2026-10-18)
**Закрывает (Fixed):** KI-196 (частично), KI-128, KI-361,
KI-362, KI-363, KI-364, KI-365, KI-048, KI-067, KI-055, KI-150,
KI-197 (остаток — Share-участники по ID), KI-206, KI-234
(для 206/234 — только провайдерский rate limit; HTTP-throttler
остался Open)
**Связанные:** KI-352, KI-360 (перспектива), KI-008 (code-split)
**RULES:** 2.5, 2.14

---

## 1. Контекст

**Точка старта.** v0.8.5 (2026-10-16). 354 KI: Fixed 136 · Open 209.
Backend 570+6 тестов, frontend 197. CI 2 job зелёный.

**Что умеет продукт сейчас:** визуальный редактор LLM-workflow
(React Flow + Zustand); 6 LLM-провайдеров + LM Studio; media
CreativeLab (57 IMAGE-моделей); Auth (JWT + refresh), Share (публичная
read-only), Export/Import/Templates, Sub-workflows; полный цикл
«нарисовал → сохранил → запустил → LLM/media выполнил → результат в
узле»; **9 типов узлов** (text, llm, image_generation, comment, http,
condition, output, compare, sub_workflow).

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

**Соглашение `kind` ↔ `type`:** `type` узла — backend-контракт
(`'image_generation'`), `kind` в `data` — UI-метка (`'image'`). Это
существующее расхождение (см. `web/src/types/graph.ts`), которое
сохраняется для новых типов: `image_tool` (kind = type), но для
media-узлов возможны исключения.

**2.2 `NODE_REGISTRY` — единая точка.** RULES 1.15. Новые категории:
`media_tools`, `media_generation`, `state`, `agent`.

**2.3 `capabilities.externalState` — активируется.** Задел из v0.7.
В v0.9: `true` для vector/memory/agent. Влияет на UI (предупреждение),
валидатор (без настроенного хранилища — refuse), миграции (коллекции по
требованию).

**2.4 `IMediaProvider` — расширяем.** Добавить `kind: 'IMAGE' | 'VIDEO'
| 'AUDIO' | 'MUSIC' | '3D' | 'TOOL'` (TOOL — семантический маркер;
upstream CreativeLab его не отдаёт, инструменты резолвятся model-first
через IMAGE/VIDEO с обязательным входным слотом — KI-366). Для `TOOL` — метод
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
`memory_write`, `code_eval` (WASM из R7.5 — общий WASM-sandbox), `llm_call`. Обоснование —
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

**Реальность upstream (KI-366/367):** `GET /media/models?type=TOOL` даёт
пустой список — CreativeLab не маркирует инструменты отдельным типом.
Инструменты резолвятся model-first: `toolModels = TOOL ∪ модели с
обязательным входом`. Дефолтные модели есть только у bg_removal
(bgremover) и lipsync (kling-lipsync); для upscale/chromakey/trim
модель выбирается вручную (KI-367). Реализовано в R7.1.

**Backend:** `MediaNodeExecutor` расширяется — `kind='image_tool'`
использует `IMediaProvider.applyToolAsync(input, tool, params)` (новый
метод). CreativeLab поддерживает операции через тот же `/api/v2/media`.
Ответ — `{ resultUrls: [{ url }], costRub, tokensIn? }`.

**Frontend:** компонент `ImageToolNode` — селект операции (5 значений),
поле `audioUrl` при operation='lipsync' (KI-369, R7.2),
селект модели (фильтр `output: 'image'`), preview входа (thumbnail из
связи). Плейсхолдер выхода — `<img>`.

**Cost budget — вводится здесь (KI-048).** Env:
- `WORKFLOW_RUN_MAX_COST_USD` (default `5`)
- `WORKFLOW_RUN_MAX_COST_RUB` (default `500`)
- `WORKFLOW_RUN_BUDGET_MODE` (`hard` | `soft`, default `hard`)

Проверка **перед** вызовом провайдера: `estimatedCost + accumulated >
budget` → узел `failed` с `error='Budget exceeded (estimated: $X,
remaining: $Y)'`. UI — прогресс-бар в TopBar (`data-run-budget`),
тултип с цифрами;
бар виден только при активном run, итог — через GET /runs/:id/budget (KI-375).

**i18n:** 5 ключей операции + 4 бюджет-сообщения (`budget.exceeded`,
`budget.warning`, `budget.remaining`, `budget.label`).

**Тесты:** 6+ юнит (executor + budget check), 1 integration (upscale
через мок-провайдер), CDP-смоук (узел с реальным изображением).

**Env:** `CREATIVELAB_TOOL_TIMEOUT_MS=120_000` (upscale/lipsync долгие).

**Взаимодействие с job-retry (KI-046):** при повторном прогоне графа
(job-level retry) стоимость предыдущих успешных вызовов **не** сбрасывается
— она уже в `node_runs.cost_usd/cost_rub` и учитывается в budget check.
Если budget исчерпан на повторной попытке, узел → failed с тем же текстом.
Это защищает от «двойного списания» (hard cap на уровне графа, не попытки).

---

### 3.2 R7.2 — Media-generation (video / audio / music)

**Закрывает:** KI-361. **~8 ч.**

**TTS-фолбэк (KI-385):** CreativeLab не отдаёт type=AUDIO (пустой
список); TTS-модели лежат в MUSIC (tts2, параметр voice). Узел
audio_generation использует фолбэк AUDIO ∪ MUSIC-модели с voice — временно.

**Три новых узла:**

    interface VideoGenNodeData {
      kind: 'video_generation';
      model: string;
      prompt?: string;
      imageUrl?: string;      // опционально: image-to-video
      durationSec?: number;   // значение из enum модели (реально:
                              // kling-v2-5 {5,10}, kling-v4 до 30; KI-388)
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
      durationSec?: number;   // из enum модели (реально:
                              // grom-zvuk вернул 240; KI-388)
      genre?: string;
    }

**Backend:** `MediaNodeExecutor` расширяется на 3 новых `kind`.
CreativeLab предоставляет VIDEO / AUDIO / MUSIC через тот же API.
Дополнительные провайдеры (через CreativeLab): **ElevenLabs** (TTS, R7.2 —
реализуется здесь), **Suno API** (music, R7.2, опционально).

**Frontend:** 3 компонента. Video — `<video controls>` в узле (с
ограничением `max-height`), Audio — `<audio controls>`, Music — то же.

**Кэш media-models — расширяется:** `GET /media/models?type=VIDEO|AUDIO
|MUSIC|3D` (уже есть в API, но UI не запрашивал).

**Cost budget — уже введён в R7.1, переиспользуется.** Video =
$0.5–5 → hard cap критичен.

**Тесты:** 6+ юнит, 3 integration (видео / аудио / музыка через мок),
CDP-смоук каждого.

**Env:** `CREATIVELAB_MEDIA_TIMEOUT_MS=600_000` (10 мин на video).

---

### 3.3 R7.3 — Image providers напрямую (Replicate / FAL / OpenAI Images)

**Новый KI:** KI-363 (заведём отдельным коммитом после Session 2).
**~4 ч.**

**Провайдеры:**
- **Replicate** — 100+ моделей через `replicate.run(modelId, input)`.
  Прямой API, ключ `REPLICATE_API_TOKEN`.
- **FAL** — быстрый inference, `FAL_KEY`. Модели: flux, SDXL, Kling (video),
  etc.
- **OpenAI Images** — `gpt-image-1`, `dall-e-3`. Уже знакомый SDK.

**Каталог — в коде (KI-366):** у Replicate `/v1/models` даёт десятки тысяч
моделей без схем параметров; у FAL каталога нет. Поэтому `REPLICATE_MODELS` /
`FAL_MODELS` — константы в провайдерах.

**Реализация (R7.3):** REST fetch (SDK не подключались — pnpm install
запрещён; запросы идентичны SDK-вызовам). `MediaRegistryService` расширяется —
несколько `IMediaProvider` подряд; `resolveByModelAsync` ищет по всем;
конфликты — по приоритету
(`CREATIVELAB > REPLICATE > FAL > OPENAI_IMAGES`, настраивается).

**Env:**

    REPLICATE_API_TOKEN=
    FAL_KEY=
    OPENAI_IMAGES_API_KEY=    # может совпадать с OPENAI_API_KEY
    OPENAI_IMAGES_BASE_URL=
    MEDIA_PROVIDER_PRIORITY=creativelab,replicate,fal,openai_images
    MEDIA_USD_RUB_RATE=100  # пересчёт тарифов USD→RUB (KI-383: дублирует
                            # WORKFLOW_RUN_USD_RUB_RATE, слить при следующей правке env)

**OpenAI Images даёт `data:image/png;base64,...` (KI-378)** — UI не
отображает; R7.8 (Media storage) конвертирует в https-ссылку.

**UI:** в селекте модели ImageGenNode — группировка по провайдеру. Формат:
`[Replicate] flux-pro-1.1-ultra`.

**Тесты:** 3 провайдера × unit-моки. Integration — смоук с реальным ключом
(у нас уже есть OpenAI).

**Стоимость — cost budget переиспользуется из R7.1.**

---

### 3.4 R7.4 — Vector DB / Memory / Agent

**Закрывает:** KI-128. **~12 ч** — самый большой срез.

**Postgres + pgvector — MVP.**

Миграция `0007_pgvector.sql`:

    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE workflow_vectors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      collection text NOT NULL,
      embedding vector(1536) NOT NULL,
      content jsonb NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX workflow_vectors_collection_idx
      ON workflow_vectors (workflow_id, collection);
    CREATE INDEX workflow_vectors_embedding_idx
      ON workflow_vectors USING hnsw (embedding vector_cosine_ops);

    CREATE TABLE workflow_memory (
      workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      key text NOT NULL,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workflow_id, key)
    );

**KI-360 (перспектива):** вынос в отдельный сервис (Qdrant/Weaviate) при
>10M vectors или >100 QPS. Пока Postgres один — pgvector логичнее.

**5 новых узлов:**

    interface VectorUpsertNodeData {
      kind: 'vector_upsert';
      collection: string;
      embeddingModel: string;   // text-embedding-3-small
      contentField?: string;    // какой ключ inputs брать как content
    }

    interface VectorQueryNodeData {
      kind: 'vector_query';
      collection: string;
      embeddingModel: string;
      topK?: number;            // default 5
      scoreThreshold?: number;  // default 0.7
    }

    interface MemoryReadNodeData {
      kind: 'memory_read';
      key: string;
    }

    interface MemoryWriteNodeData {
      kind: 'memory_write';
      key: string;
      valueField?: string;      // какой ключ inputs сохранять
    }

    interface AgentNodeData {
      kind: 'agent';
      model: string;
      systemPrompt?: string;
      tools: string[];          // ['http_request', 'vector_query', ...]
      maxIterations?: number;   // default 5
      maxTokensPerStep?: number;
    }

**Embeddings:** `ILlmProvider.embedAsync(texts: string[]): Promise<number[][]>`
— новый метод. OpenAI, RouterAI, DeepSeek (через свои `/embeddings`).
Anthropic — нет embeddings, fallback на OpenAI. Модели:
`text-embedding-3-small` (1536), `text-embedding-3-large` (3072).

**Agent loop — свой (~300 строк TS):**

    type AgentStep =
      | { kind: 'llm'; prompt: string; usage: LlmUsage }
      | { kind: 'tool'; name: string; input: unknown; output: unknown; error?: string }
      | { kind: 'final'; answer: string };

    async function runAgentAsync(
      node: AgentNodeData,
      inputs: unknown,
    ): Promise<AgentRunResult> {
      const messages: Message[] = [{ role: 'user', content: JSON.stringify(inputs) }];
      const steps: AgentStep[] = [];
      for (let i = 0; i < (node.maxIterations ?? 5); i++) {
        const response = await llm.generateAsync({ model, messages, tools: node.tools });
        steps.push({ kind: 'llm', ... });
        if (response.final) return { answer: response.final, steps };
        const toolCall = response.toolCall;
        const tool = TOOL_REGISTRY[toolCall.name];
        const result = await tool.executeAsync(toolCall.input, { runId, nodeId });
        steps.push({ kind: 'tool', ... });
        messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] });
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
      throw new AgentIterationLimitException(...);
    }

**Базовые tools:** `http_request`, `vector_query`, `vector_upsert`,
`memory_read`, `memory_write`, `code_eval` (WASM из R7.5 — общий WASM-sandbox), `llm_call`.
**Перспектива v0.10 — MCP adapter** (Playwright, Puppeteer, filesystem):
MCP — открытый стандарт Anthropic, лёгкий, не как LangChain.

**Frontend:** 5 компонентов. Agent-узел — селект model + сворачиваемый
список tools (чекбоксы) + textarea system prompt. В RunResultPanel —
timeline шагов (`data-agent-step`).

**i18n:** ~40 ключей.

**Тесты:** 30+ юнит (executor × 5, embed, agent loop, tools), 3 integration
(RAG-пайплайн, memory read/write, agent с 3 шагами).

**Env:**

    PGVECTOR_ENABLED=false  # включить: true
    EMBEDDING_MODEL_DEFAULT=text-embedding-3-small
    AGENT_MAX_ITERATIONS_DEFAULT=5
    AGENT_MAX_TOKENS_PER_STEP_DEFAULT=2048
    VECTOR_HNSW_M=16
    VECTOR_HNSW_EF_CONSTRUCTION=64

---

### 3.5 R7.5 — WASM sandbox (condition + code_eval)

**Закрывает:** KI-364 (+ используется в agent-tool `code_eval` из § 3.4).
**~4 ч.**

**Общий модуль для двух потребителей:**
1. **Condition-узел** — режим `mode: 'sandbox'` вместо MVP-DSL.
2. **Agent-tool `code_eval`** — вычисление JS в цикле агента.

**Не подходит:** `new Function` — RCE; `vm2` — deprecated (CVE-2023-29017);
`isolated-vm` — native build сложен на Windows + Docker (пересборка под
каждую платформу); Node `vm` — небезопасен (`this.constructor.constructor`).

**QuickJS-WASM (`quickjs-emscripten`) — выбранная модель:** Figma плагины
(2020), Cloudflare Workers, Shopify Functions. WASM — переносимый бинарник,
работает одинаково на Windows dev и Linux prod. ~200 КБ lazy-loaded.

**Модуль** `src/sandbox/quickjs-runner.service.ts`:

    interface SandboxOptions {
      timeoutMs?: number;      // default 100
      memoryLimitMb?: number;  // default 16
      allowlist?: string[];    // default: input, Math, JSON, Date, String,
                               //          Number, Array, Object, Boolean
    }

    async function evaluateSandboxedAsync(
      expression: string,
      input: unknown,
      options?: SandboxOptions,
    ): Promise<{ result: unknown; error?: string }>;

**Запрещены:** `Function`, `eval`, `require`, `process`, `globalThis`,
`fetch`, `window`, `document`. Timeout 100 мс — kill VM. Memory limit
16 МБ — kill VM.

**Обратная совместимость (condition):** старый MVP-DSL парсится и
конвертируется в JS: `input.value > 100` → `input.value > 100` (для простых сравнений — тождественно).

    interface ConditionNodeData {
      kind: 'condition';
      mode: 'dsl' | 'sandbox';  // новый, default 'dsl' (backward compat)
      expression: string;       // DSL или JS, в зависимости от mode
    }

**Fallback:** если WASM не загрузился — log warn, режим `sandbox`
refuse to run (узел failed с `error='Sandbox unavailable'`), режим
`dsl` работает всегда.

**Frontend:** в ConditionNode — селект «DSL / JavaScript». При JS —
предупреждение «Выражение исполняется в изолированной VM (QuickJS-WASM)».

**Тесты:** 15+ юнит (timeout, memory, escape-попытки
`constructor.constructor`, `eval`, `require`), интеграция с реальным
condition-узлом в режиме sandbox.

**Env:** `SANDBOX_ENABLED=false  # включить: true`, `SANDBOX_TIMEOUT_MS=100`,
`SANDBOX_MEMORY_MB=16`.

---

### 3.6 R7.6 — Share-участники по ID (остаток KI-197)

**Закрывает:** KI-197 (остаток). **~5 ч.**

**Таблица `workflow_collaborators` (миграция `0010_collaborators.sql`):**

    CREATE TABLE workflow_collaborators (
      workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('viewer', 'editor')),
      invited_at timestamptz NOT NULL DEFAULT now(),
      invited_by uuid NOT NULL REFERENCES users(id),
      PRIMARY KEY (workflow_id, user_id)
    );

**Роли:**
- **viewer** — read-only (аналог share-token, но по ID).
- **editor** — правка графа, Save, Run; **не** может удалить workflow
  или приглашать других.

**Эндпоинты:**
- `GET /workflow/:id/collaborators` — список (owner + participants).
- `POST /workflow/:id/collaborators { userId, role }` — пригласить по uuid.
- `PATCH /workflow/:id/collaborators/:userId { role }` — изменить роль.
- `DELETE /workflow/:id/collaborators/:userId` — удалить.

**Owner-check расширяется:** `buildAccessFilter` в `WorkflowService` —
учитывает `OR user_id = $1 OR EXISTS(SELECT FROM workflow_collaborators
WHERE ...)`. Role-aware: `viewer` → только GET; `editor` → GET+POST+PATCH,
не DELETE.

**UI:** в ShareModal — новая вкладка «Участники»: input для user uuid +
селект роли + список. Инвайт **по uuid** (не по email — email-нотификации
вне scope v0.9).

**Тесты:** 10+ юнит (roles, access), 2 integration (viewer GET, editor POST),
CDP-смоук.

**KI-232 (Welcome screen) — НЕ входит в R7.6,** в § 6 (что не
входит).

---

### 3.7 R7.7 — Observability + production hardening

**Закрывает:** KI-067, KI-055, KI-150, KI-365, KI-206, KI-234. **~8 ч.**

**7.7.1 OpenTelemetry traces (KI-365).**
- `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http`.
- Spans: `run.execute`, `node.execute`, `llm.call`, `media.createTask`,
  `agent.step`.
- Env: `OTEL_ENABLED=false` (default), `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Локально — Jaeger через `docker-compose.otel.yml` (опционально).

**7.7.2 Rate limiting per-provider (KI-067, KI-206, KI-234).**
- Semaphore на каждый провайдер (`LLM_PROVIDER_MAX_CONCURRENCY_ANTHROPIC=5`
  и т.д.).
- Использует `p-limit` или самописный (200 строк).
- Env: `LLM_PROVIDER_MAX_CONCURRENCY_<NAME>` (default: без ограничения —
  backward compat).

**7.7.3 Reasoning cache tokens (KI-055, KI-150).**
- `LlmUsage` расширяется: `cacheReadTokens?: number`,
  `cacheCreationTokens?: number`.
- Нормализация: **Anthropic** — `cache_control: ephemeral` при
  systemPrompt > 1024 (по флагу `data.promptCache=true`, не по умолчанию);
  **OpenAI** — `usage.prompt_tokens_details.cached_tokens` (автоматически);
  **DeepSeek** — `prompt_cache_hit_tokens` (автоматически);
  **GPTunnel/RouterAI** — зависит от upstream; **Yandex** — нет (честно
  писать «кэш недоступен»); **LM Studio** — не применимо.
- `MODEL_PRICING` — `{ cacheRead: X, cacheCreation: Y }`.
- Новые колонки `node_runs.cache_read_tokens`, `cache_creation_tokens`
  (миграция `0008_cache_tokens.sql`).
- UI: `RunResultPanel` — «Cache read: 12 500 tokens (экономия $0.34)».

**7.7.4 Cost budget — уже в R7.1.** Здесь только аналитика: агрегат
`workflow_runs.total_cost_usd/total_cost_rub` (денормализация, KI-054) +
endpoint `GET /runs/:id/costs`.

**Тесты:** 5+ OTel (span creation), 5+ semaphore, 10+ cache tokens
(3 провайдера), CDP-смоук.

**Env (сводно):**

    OTEL_ENABLED=false
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
    LLM_PROVIDER_MAX_CONCURRENCY_ANTHROPIC=10
    LLM_PROVIDER_MAX_CONCURRENCY_OPENAI=10
    LLM_PROVIDER_MAX_CONCURRENCY_GPTUNNEL=5
    PROMPT_CACHE_ENABLED=false  # включить: true
    PROMPT_CACHE_MIN_TOKENS=1024

---

### 3.8 R7.8 — Media storage (S3 / TTL)

**Закрывает:** KI-362. **~3 ч.**

**Проблема:** CreativeLab отдаёт `resultUrls`, живущие 48 часов.
Через 2 суток `node_runs.outputs` содержит мёртвые ссылки.

**Решение — двухслойное:**

**Слой 1: локальное хранилище (default).**
- Env: `MEDIA_STORAGE_BACKEND=local | s3 | none`, default `local`.
- `local` — файлы в `./data/media/{runId}/{nodeId}.{ext}`, URL
  `/api/media/file/:id`, отдача через `@nestjs/serve-static`.
- Скачивание происходит сразу после успешной media-задачи (`fetch` +
  стрим в файл).

**Слой 2: S3 (opt-in).**
- Env: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_TTL_DAYS=30`.
- Presigned URL на GET с TTL.
- Провайдеры: AWS S3, MinIO, Cloudflare R2, Yandex Object Storage.

**Миграция `0009_media_storage.sql`:**

    ALTER TABLE node_runs
      ADD COLUMN stored_url text,
      ADD COLUMN stored_expires_at timestamptz;

**Поведение:**
- `node_runs.outputs` — всегда имеет `resultUrls` (для совместимости).
- `node_runs.stored_url` — своя ссылка (stable, к нам).
- UI `<img>`/`<video>` использует `stored_url ?? resultUrls[0].url`.
- Если оба отсутствуют или `stored_expires_at < now()` — маркер
  «ссылка истекла» (серый placeholder).

**Frontend:**
- `ImageGenNode` / `VideoGenNode` / `AudioGenNode` — `src` берётся из
  `stored_url`, fallback на `resultUrls`.
- Компонент `ExpiredMediaPlaceholder`.

**Тесты:** 8+ юнит (local backend, S3-мок, TTL), 1 integration
(реальный локальный storage), CDP-смоук.

**Env:**

    MEDIA_STORAGE_BACKEND=local
    MEDIA_STORAGE_LOCAL_PATH=./data/media
    MEDIA_STORAGE_LOCAL_TTL_DAYS=30
    S3_ENDPOINT=
    S3_BUCKET=
    S3_ACCESS_KEY_ID=
    S3_SECRET_ACCESS_KEY=
    S3_REGION=
    S3_TTL_DAYS=30

---

## 4. Совместимость и миграция

**4.1 `NodeData`.** Все новые поля — optional. Существующие workflow
работают без миграции. `nodeDataFromApi` расширяется (паттерн KI-129,
KI-266) — новые ветки discriminated union.

**4.2 Миграции БД:**
- `0007_pgvector.sql` — extension + 2 таблицы (R7.4).
- `0008_cache_tokens.sql` — 2 колонки в `node_runs` (R7.7.3).
- `0009_media_storage.sql` — 2 колонки в `node_runs` (R7.8).
- `0010_collaborators.sql` — `workflow_collaborators` (R7.6).

Порядок применения в CI: шаг `Apply migrations` (RULES § 3.19) уже настроен.

**4.3 Env — все фичи opt-in, кроме cost budget (opt-out).** Defaults:
- Cost budget: **ON** (`WORKFLOW_RUN_MAX_COST_USD=5`,
  `WORKFLOW_RUN_MAX_COST_RUB=500`).
- Vector/Agent: **OFF** (`PGVECTOR_ENABLED=false`).
- Sandbox: **OFF** (`SANDBOX_ENABLED=false`).
- Media storage: **local** (без S3 — работает «из коробки»).
- OTel: **OFF** (`OTEL_ENABLED=false`).
- Rate limiting per-provider: **OFF** (backward compat).
- Prompt cache: **OFF по умолчанию** (`PROMPT_CACHE_ENABLED=false`).

**4.4 RULES — новые пункты (v1.9.0):**
- **§ 1.18** — tools в Agent node: discriminated union с Zod input schema.
- **§ 1.19** — sandbox-выражения только через WASM
  (`evaluateSandboxedAsync`); не использовать `new Function`, `eval`, `vm`,
  `vm2`, `isolated-vm` (Windows).
- **§ 3.22** — budget check перед вызовом платного провайдера.
- **§ 5.11** — capability-токены media-presigned URL не логировать.

**4.5 API-контракты:**
- `docs/development/api-contract.json` (KI-352) — расширяется новыми
  DTO: `CollaboratorResponse`, `CostSummaryResponse`.
- `docs/development/sse-contract.json` (KI-348) — расширяется новым
  событием `agent_step` (опционально; UI timeline).

**4.6 Frontend bundle.** +QuickJS-WASM (~200 КБ lazy) + новые узлы.
`chunkSizeWarningLimit` может вырасти до 900; **лучше** — code-split
(KI-008) в этом же релизе.

---

## 5. План работ

| # | Тема | ~dsh | Риск | Зависимости |
|---|---|---|---|---|
| R7.1 | Media-инструменты + cost budget | 6 ч | 🟢 Low | — |
| R7.2 | Video/Audio/Music узлы | 8 ч | 🟡 Medium | R7.1 (budget) |
| R7.3 | Image providers (Replicate/FAL/OpenAI Images) | 4 ч | 🟢 Low | — |
| R7.4 | Vector/Memory/Agent (pgvector) | 12 ч | 🟠 High | R7.5 (code_eval) |
| R7.5 | WASM sandbox (condition + code_eval) | 4 ч | 🟡 Medium | — |
| R7.6 | Share-участники по ID | 5 ч | 🟢 Low | — |
| R7.7 | Observability + cache tokens | 8 ч | 🟡 Medium | R7.4 |
| R7.8 | Media storage (S3 / TTL) | 3 ч | 🟢 Low | — |
| **Итого** | | **~50 ч** | | |

**Порядок:**
1. **R7.1 + R7.3** (параллельно, 2 сессии dsh) — изолированы, Low-риск.
2. **R7.2** (после R7.1 — budget переиспользуется) + **R7.5** (изолирован,
   можно параллельно).
3. **R7.4** (после R7.5 — использует `code_eval` tool) + **R7.6**
   (параллельно с R7.4).
4. **R7.8** (после R7.2 — использует media-urls).
5. **R7.7** (последним — использует cost из R7.1, cache из R7.4-embeddings,
   OTel-span'ы во всех остальных).

**По сессиям dsh:** пул из 2-3 параллельных, правило Cache hit > 90% →
новая сессия. После каждого подшага — CI + commit + (если нужно) docs.

---

## 6. Что НЕ входит в v0.9

| KI / тема | Куда |
|---|---|
| **KI-232** Welcome screen (шаблоны при старте) | v0.10 |
| **3D / Motion** (из KI-196) — 3D-сцена, motion-ролик | v0.10 |
| **Multi-tenant изоляция** (organizations, members, billing) | v0.10 / v1.0 |
| **MCP adapter** (Playwright/Puppeteer/filesystem) | v0.10 |
| **Отдельный vector service** (Qdrant/Weaviate) — KI-360 | v0.10+ |
| **Human-in-the-loop** (ручное подтверждение узла) | v0.10 |
| **Video/Audio/Music direct providers** (Runway, ElevenLabs direct, Suno — в отличие от ElevenLabs/Suno через CreativeLab в R7.2) | v0.10 |
| **Anthropic extended thinking** (reasoning > medium) | v0.10 |
| **Realtime collaboration** (несколько пользователей в редакторе) | v1.0+ |
| **Billing / подписки** | вне роадмапа |

**Причина по multi-tenant:** single-tenant per user сейчас работает; для
B2B нужны ~15-20 ч dsh + переработка модели данных (organizations,
members, billing — v0.10/v1.0 при появлении B2B-спроса). Вернёмся, когда
будет 2-3 B2B-клиента или переход на SaaS.

---

## 7. Риски и открытые вопросы

**7.1 Стоимость media.** Video = $0.5-5 за генерацию. Cost budget — hard
cap, default $5/run. Но media-модели из разных провайдеров → калибровка
`estimatedCost` под каждый. **Открыто:** считать `estimatedCost` по прайсу
модели (грубо) или спрашивать у провайдера `estimateAsync` (точно, но
медленно)? **Рекомендация:** грубо + margin 20%; уточнять при появлении
жалоб.

**7.2 pgvector — масштабирование.** HNSW-индекс на 1M vectors работает;
>10M — падение latency. **Решение:** KI-360 (отдельный сервис), если
возникнет. Не блокер v0.9.

**7.3 WASM sandbox — совместимость.** `quickjs-emscripten` — ESM, ~200 КБ.
Проверено: работает в Node 22+ и в браузере. **Открыто:**
WASM-инициализация ~30 мс при старте — lazy или при первом обращении?
**Рекомендация:** lazy при первом использовании (первый condition/agent
с code_eval не должен ждать 30 мс).

**7.4 Agent loop — debugging.** Свой loop = полный контроль, но нужно
**хорошо** отлаживать. **Решение:** `AgentStep[]` пишется в
`node_runs.logs`, UI timeline показывает шаги. Логи не сокращать
(RULES § 5.9 — только хэши промптов).

**7.5 Prompt caching — Anthropic 5 min.** Короткий TTL. **Открыто:**
включать по умолчанию при `systemPrompt > 1024` или только по флагу
`data.promptCache=true`? **Решено:** только по флагу (иначе — скрытая
плата за cache_creation при коротких пайплайнах).

**7.6 Bundle size.** +200 КБ WASM + новые узлы → >900 КБ. **Решение:**
code-split (KI-008) в этом же релизе. React.lazy для новых узлов +
dynamic import для WASM.

**7.7 Postgres один.** pgvector + workflow-таблицы на одной БД. При
росте — реплики. **Не блокер v0.9.** KI-360 (перспектива) — вынос
vector store.

**7.8 Rate limiting per-provider — default OFF.** Чтобы не сломать
существующих пользователей (backward compat — default OFF). Включается
env'ом. **Открыто:** предупреждать ли в логе при превышении default?
**Решение:** да, warn в первый раз на провайдера.

**7.9 Media storage local — диск.** Файлы в `./data/media/`, без TTL
cleanup. **Решение:** background job (BullMQ repeatable, раз в сутки)
удаляет файлы старше `MEDIA_STORAGE_LOCAL_TTL_DAYS` (default 30).

---

## 8. Решения

Утверждено 2026-10-16 (ревью пройдено).

| # | Решение | Дата |
|---|---------|------|
| 1 | Cost budget — **hard cap**, default $5 / 500 ₽, вводится в R7.1 | 2026-10-16 |
| 2 | pgvector в текущей PostgreSQL; KI-360 (отдельный сервис) — перспектива | 2026-10-16 |
| 3 | Condition sandbox — **QuickJS-WASM** (не isolated-vm, не vm2) | 2026-10-16 |
| 4 | Agent loop — **свой** (~300 строк) + базовые tools; MCP — v0.10 | 2026-10-16 |
| 5 | Reasoning cache tokens — нормализация для всех OpenAI-совместимых + Anthropic; Yandex — «недоступно» | 2026-10-16 |
| 6 | R7.5 — **общий WASM sandbox** для condition + code_eval (устранён конфликт номеров) | 2026-10-16 |
| 7 | Multi-tenant, Welcome screen, 3D/motion, MCP adapter — **НЕ в v0.9** (см. § 6) | 2026-10-16 |
| 8 | Prompt cache — по флагу `data.promptCache=true`, не по умолчанию | 2026-10-16 |

---

**Конец документа.**

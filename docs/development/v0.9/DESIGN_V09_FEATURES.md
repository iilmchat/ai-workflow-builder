# DESIGN v0.9 — Медиа, состояние, агенты

**Файл:** `docs/development/v0.9/DESIGN_V09_FEATURES.md`
**Версия:** 0.1 (draft)
**Дата:** 2026-10-16
**Статус:** Draft (на ревью)
**Закрывает (Fixed):** KI-196 (частично), KI-128, KI-361,
KI-362, KI-048, KI-067, KI-197 (остаток), KI-055, KI-150
**Связанные:** KI-352, KI-360 (перспектива), KI-008 (code-split)
**RULES:** 2.5, 2.14

---

## 1. Контекст

**Точка старта.** v0.8.5 (2026-10-16). 351 KI: Fixed 136 · Open 206.
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

**Взаимодействие с job-retry (KI-046):** при повторном прогоне графа
(job-level retry) стоимость предыдущих успешных вызовов **не** сбрасывается
— она уже в `node_runs.cost_usd/cost_rub` и учитывается в budget check.
Если budget исчерпан на повторной попытке, узел → failed с тем же текстом.
Это защищает от «двойного списания» (hard cap на уровне графа, не попытки).

---

### 3.2 R7.2 — Media-generation (video / audio / music)

**Закрывает:** KI-361. **~8 ч.**

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
Дополнительные провайдеры: **ElevenLabs** (TTS, R7.2 —
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

**Реализация:** `MediaRegistryService` расширяется — несколько
`IMediaProvider` подряд; `resolveByModelAsync` ищет по всем; конфликты — по
приоритету (`CREATIVELAB > REPLICATE > FAL > OPENAI_IMAGES`, настраивается).

**Env:**

    REPLICATE_API_TOKEN=
    FAL_KEY=
    OPENAI_IMAGES_API_KEY=    # может совпадать с OPENAI_API_KEY
    OPENAI_IMAGES_BASE_URL=
    MEDIA_PROVIDER_PRIORITY=creativelab,replicate,fal,openai_images

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
`memory_read`, `memory_write`, `code_eval` (WASM из R7.5), `llm_call`.
**Перспектива v0.10 — MCP adapter** (Playwright, Puppeteer, filesystem):
MCP — открытый стандарт Anthropic, лёгкий, не как LangChain.

**Frontend:** 5 компонентов. Agent-узел — селект model + сворачиваемый
список tools (чекбоксы) + textarea system prompt. В RunResultPanel —
timeline шагов (`data-agent-step`).

**i18n:** ~40 ключей.

**Тесты:** 30+ юнит (executor × 5, embed, agent loop, tools), 3 integration
(RAG-пайплайн, memory read/write, agent с 3 шагами).

**Env:**

    PGVECTOR_ENABLED=true
    EMBEDDING_MODEL_DEFAULT=text-embedding-3-small
    AGENT_MAX_ITERATIONS_DEFAULT=5
    AGENT_MAX_TOKENS_PER_STEP_DEFAULT=2048
    VECTOR_HNSW_M=16
    VECTOR_HNSW_EF_CONSTRUCTION=64

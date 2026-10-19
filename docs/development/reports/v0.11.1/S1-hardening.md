---
title: "S1: Hardening — KI-500 (SDK retries) + KI-418 (image_tool)"
date: 2026-10-19
version: v0.11.1
steps: [S1]
status: accepted
related_ki: [KI-500, KI-418, KI-523, KI-524]
related_adr: []
---

# Отчёт S1: Hardening (KI-500, KI-418)

## 1. Файлы (+/-)

| Файл | Строки | Что изменено |
|---|---:|---|
| `src/llm/providers/openai-compatible.provider.ts` | +9 / −1 | `maxRetries: 0` в конструкторе OpenAI SDK + комментарий KI-500 |
| `src/llm/providers/anthropic.provider.ts` | +4 / −1 | `maxRetries: 0` в конструкторе Anthropic SDK + комментарий KI-500 |
| `src/llm/providers/openai-compatible.provider.spec.ts` | +12 / −0 | Проверки `maxRetries: 0` в трёх конфигурациях + отдельный тест |
| `src/llm/providers/anthropic.provider.spec.ts` | +19 / −2 | Захват опций конструктора SDK и тест `maxRetries: 0` |
| `src/llm/llm-provider.factory.spec.ts` | +6 / −0 | Три ожидания конструктора OpenAI дополнены `maxRetries: 0` |
| `src/engine/execution-engine.service.spec.ts` | +33 / −0 | Тест: 429 → ровно `NODE_RETRY_MAX_ATTEMPTS` вызовов движка |
| `src/media/image-tool.spec.ts` | +59 / −0 | Новый спек: дефолтные модели для всех доступных операций, `chromakey` скрыт |
| `web/src/types/graph.ts` | +19 / −2 | `UI_IMAGE_TOOL_OPERATIONS` без `chromakey`; уточнён JSDoc |
| `web/src/components/nodes/ImageToolNode.tsx` | +16 / −5 | Селект по UI-списку; legacy `chromakey` — disabled-опция |
| `web/src/components/nodes/ImageToolNode.spec.tsx` | +44 / −5 | Тесты: `chromakey` нет в списке, legacy-значение недоступно |
| `web/src/i18n/ru.json` | +1 / −0 | `node.image_tool.operation.unavailable` |
| `web/src/i18n/en.json` | +1 / −0 | `node.image_tool.operation.unavailable` |
| `docs/CHANGELOG.md` | +15 / −0 | `[Unreleased] → Fixed`: KI-500 и KI-418 со ссылкой на отчёт |
| `docs/KNOWN_ISSUES.md` | +55 / −11 | KI-418/KI-500 → Fixed; новые KI-523/KI-524; сводка 512 |
| `docs/development/reports/README.md` | +1 / −0 | Строка отчёта v0.11.1 S1 |
| `docs/development/reports/v0.11.1/S1-hardening.md` | новый | Этот отчёт |

Итого по коду: 7 файлов `src/` (+142 / −4) и 5 файлов `web/` (+81 / −12),
плюс документация. Коммит не создавался (запрет промпта).

## 2. Build / test

`pnpm build` → exit 0, 0 errors, 0 warnings. `pnpm typecheck` → exit 0.
`pnpm test` → 101 файл passed, 3 skipped; 1431 тест passed, 18 skipped.
`pnpm --dir web test` → 50 файлов, 419 тестов passed.
`pnpm --dir web build` → exit 0 (одно предупреждение Vite про JSON-import —
существовавшее до правки, см. § 5).

## 3. Диагностика

1. **Первый полный `pnpm test` упал на 3 тестах**
   `src/llm/llm-provider.factory.spec.ts`: они сравнивали опции конструктора
   OpenAI через `toHaveBeenCalledWith({ apiKey, baseURL })`, а после KI-500
   появился `maxRetries: 0`. Это ожидаемое расхождение контракта, а не
   регрессия. Ожидания дополнены полем и комментарием; повторный прогон —
   1431/1431.
2. **Первый `pnpm typecheck` упал в новом `image-tool.spec.ts`**:
   `HIDDEN_OPERATIONS` был выведен как `readonly ["chromakey"]`, а
   `Array.includes` вызывался с полным union операций (TS2345). Исправлено
   явной аннотацией `readonly ImageToolOperation[]`; повторный typecheck — 0.
3. **Проверка SDK в реальном сценарии.** Юнит-моки SDK не воспроизводят
   внутренние повторы, поэтому отдельно поднят локальный HTTP-сервер,
   отдающий 429, и вызваны настоящие SDK через провайдеры (см. § 4).

## 4. Smoke

### 4.1. 429 без скрытых ретраев SDK (локальный upstream)

Скрипт `.tmp/ki500-smoke.ts`: локальный `node:http`-сервер всегда отвечает
`429` с `Retry-After: 0`; создаются реальные `OpenAiCompatibleProvider` и
`AnthropicProvider`; считаются фактические HTTP-запросы. Окружение:
`NODE_RETRY_MAX_ATTEMPTS=3`.

```json
{
  "nodeRetryMaxAttemptsEnv": "3",
  "results": [
    {
      "provider": "openai",
      "upstreamRequests": 1,
      "error": "[openai] 429 smoke 429",
      "retryable": true
    },
    {
      "provider": "anthropic",
      "upstreamRequests": 1,
      "error": "[anthropic] 429 {\"error\":{\"type\":\"rate_limit_error\",\"message\":\"smoke 429\"}}",
      "retryable": true
    }
  ],
  "totalUpstreamRequests": 2,
  "urls": [
    "POST /v1/chat/completions",
    "POST /v1/messages"
  ]
}
```

Вывод: на каждый провайдер ушёл ровно **1** запрос. При дефолтном
`maxRetries=2` было бы 3 запроса на каждый вызов провайдера. Ошибка
классифицирована как `retryable: true` — повтор остаётся за движком.

### 4.2. Движок делает ровно N попыток

Тест `KI-500: 429 от провайдера — ровно NODE_RETRY_MAX_ATTEMPTS вызовов, без
скрытых ретраев SDK` (в `execution-engine.service.spec.ts`) подменяет
`runNodeAsync`: каждый вызов бросает `LlmProviderException('openai', '429 rate
limit', { retryable: true, retryAfterMs: 1 })`. Результат:

- `calls === NODE_RETRY_DEFAULTS.maxAttempts` (3);
- в `node_runs.logs` ровно 2 записи о неудачных попытках;
- запуск завершается `failed`, наружу уходит исходная ошибка.

До KI-500 тот же сценарий мог дать 3 попытки движка × 3 запроса SDK = 9
платных upstream-вызовов.

### 4.3. KI-418

- `src/media/image-tool.spec.ts`: у `upscale`, `bg_removal`, `trim`, `lipsync`
  непустые списки дефолтных моделей; `upscale` = FAL `clarity-upscaler` →
  Replicate `real-esrgan`; `chromakey` = `[]`.
- `ImageToolNode.spec.tsx`: новый узел не содержит опции «Хромакей»;
  legacy-узел с `chromakey` показывает её выбранной и `disabled`.
- `media-node-executor.tool.spec.ts` (существующий тест KI-367): при
  `operation: 'upscale'` без модели выбирается
  `fal:fal-ai/clarity-upscaler` — fallback работает.

### 4.4. Ограничение smoke

Полный запуск приложения с реальными ключами провайдеров не выполнялся:
это платные внешние вызовы, а в окружении нет гарантированно валидных ключей.
Сценарий 429 воспроизведён локальным сервером с настоящими SDK и настоящими
классами провайдеров; движок проверен юнит-тестом с подсчётом вызовов.

## 5. Что не так

1. **`maxRetries: 0` захардкожен.** Оператор не может временно включить
   внутренние ретраи SDK без пересборки. Это осознанный выбор (защита от
   двойного списания), но диагностическая гибкость потеряна — KI-523.
2. **Списки операций `image_tool` продублированы.** Backend
   `IMAGE_TOOL_OPERATIONS` и UI `UI_IMAGE_TOOL_OPERATIONS` — независимые
   константы; `chromakey` скрыт только в UI. При появлении модели её нужно
   править в двух местах — KI-524.
3. **Legacy `chromakey` остаётся исполняемым значением backend.** Если в
   старом workflow у узла был явно выбран id модели, executor попробует
   вызвать её; если модели нет — упадёт с «не выбрана модель». Это сохранено
   намеренно ради обратной совместимости и отсутствия молчаливой подмены.
4. **`pnpm --dir web build` печатает предупреждение Vite** о JSON-import без
   import attributes (`api-prefixes.json`). Оно существовало до правки,
   к KI-418/KI-500 отношения не имеет; сборка завершается успешно.
5. **Тест движка использует дефолт `NODE_RETRY_MAX_ATTEMPTS`**, а не
   переопределение env в конструкторе. Отдельный тест на env-переопределение
   остаётся KI-504 (не входит в S1).
6. **`pnpm test` в этой оболочке возвращает код 0 из-за завершающего
   `Write-Output` в цепочке `Tee-Object`**, поэтому факт успеха определялся по
   строке `Tests ... passed` и отсутствию `FAIL`, а не только по коду.

## 6. Новые KI

- **KI-523 — `maxRetries: 0` для SDK захардкожен.** 🟢 Low, Open.
  Нет env-флага для временного включения внутренних ретраев SDK. Файлы:
  `src/llm/providers/openai-compatible.provider.ts`,
  `src/llm/providers/anthropic.provider.ts`.
- **KI-524 — Список операций `image_tool` продублирован в UI.** 🟢 Low, Open.
  Backend и UI хранят операции независимо; `chromakey` скрыт только в UI.
  Файлы: `src/media/image-tool.ts`, `web/src/types/graph.ts`.

Других новых проблем не найдено.

## 7. Обоснование решений

1. **Почему `maxRetries: 0`, а не «оставить SDK, убрать движок».** Движок —
   единственное место, где повтор виден в `node_runs.logs`, учитывается
   бюджетом (KI-048), использует `Retry-After` (v0.11 S10) и не создаёт
   дубль платной задачи благодаря `idempotencyKey`. Ретраи SDK невидимы,
   умножают стоимость и не дают применить бюджетный предохранитель. Поэтому
   источником повторов должен быть только движок.
2. **Почему не env-флаг сразу.** Флаг с дефолтом `0` — это дополнительная
   поверхность конфигурации и риск, что в production его включат и вернут
   двойное списание. Для S1 выбрано безопасное поведение по умолчанию;
   возможность управлять им вынесена в KI-523.
3. **Почему `chromakey` скрыт, а не замаплен на «похожую» модель.** Ни
   CreativeLab, ни FAL, ни Replicate не объявляют модель хромакея. Подстановка
   модели с другой семантикой — это платный запрос с неверным результатом
   (принцип KI-069, KI-367). Скрытие операции в UI убирает неработающую
   кнопку, не ломая backend-контракт старых workflow.
4. **Почему legacy `chromakey` не переписывается молча.** Нормализация
   значения в `bg_removal` изменила бы смысл сохранённого узла без ведома
   пользователя. Вместо этого UI показывает выбранное значение как
   недоступное; пользователь сам решает, заменить операцию или удалить узел.
5. **Почему `upscale` не менялся.** Fallback уже реализован в R7.1/R7.3 и
   покрыт `media-node-executor.tool.spec.ts`. Добавлен контрактный тест
   `image-tool.spec.ts`, чтобы список дефолтов не потерялся при будущих
   правках.
6. **Почему тесты на трёх уровнях.** (а) опции конструктора SDK — фиксируют
   `maxRetries: 0`; (б) тест движка — фиксирует ровно N попыток и отсутствие
   умножения; (в) smoke с реальным SDK и локальным 429 — фиксирует
   фактическое число HTTP-запросов, которое не видно в моках. Это закрывает
   именно тот разрыв, из-за которого KI-500 существовал незамеченным.

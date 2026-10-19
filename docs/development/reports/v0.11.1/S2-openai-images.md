---
title: "S2: OpenAI Images applyToolAsync (KI-380)"
date: 2026-10-19
version: v0.11.1
steps: [S2]
status: accepted
related_ki: [KI-380, KI-525]
related_adr: []
---

# Отчёт S2: OpenAI Images `applyToolAsync` (KI-380)

## 1. Файлы (+/-)

| Файл | Строки | Что изменено |
|---|---:|---|
| `src/media/providers/openai-images.provider.ts` | +376 / −48 | Реальный `applyToolAsync` через `/v1/images/edits`: скачивание входа, multipart, разбор ответа, лимиты, SSRF-проверка, идемпотентность |
| `src/media/providers/openai-images.provider.spec.ts` | +215 / −21 | Тесты multipart: b64 и url, `bg_removal`, идемпотентность, отказы до сети, лимит, SSRF |
| `docs/CHANGELOG.md` | +8 / −0 | `[Unreleased] → Fixed`: KI-380 со ссылкой на отчёт |
| `docs/KNOWN_ISSUES.md` | +34 / −11 | KI-380 → Fixed; новая KI-525; удалены дубли KI-523/KI-524; сводка 513 |
| `docs/development/reports/README.md` | +1 / −0 | Строка отчёта v0.11.1 S2 |
| `docs/development/reports/v0.11.1/S2-openai-images.md` | новый | Этот отчёт |

Итого по коду: 2 файла `src/` (+591 / −69). Коммит не создавался
(запрет промпта).

## 2. Build / test

`pnpm build` → exit 0, 0 errors, 0 warnings. `pnpm typecheck` → exit 0.
`pnpm test` → 101 файл passed, 3 skipped; 1439 тестов passed, 18 skipped
(1457). Целевой прогон
`src/media/providers/openai-images.provider.spec.ts` → 23/23 passed.
Фронтенд не менялся (`pnpm --dir web test` в S2 не запускался).

## 3. Диагностика

1. **`pnpm typecheck` упал на типах бинарного тела.** `Buffer` в Node
   типизирован как `Buffer<ArrayBufferLike>`, а `BlobPart` требует
   `ArrayBuffer` без `SharedArrayBuffer`; `rawBody?: string | Uint8Array` в
   тестовой заглушке также не подходил под `BodyInit`. Исправлено копией
   `new Uint8Array(image.buffer.length)` + `set(image.buffer)` и сужением
   `rawBody` до `string`. Повторный typecheck — 0.
2. **В реестре KI обнаружены дубли KI-523 и KI-524** (по две записи с разным
   форматированием). Дубли удалены, чтобы нумерация и сводка оставались
   однозначными; после закрытия KI-380 и добавления KI-525 пересчёт по grep:
   513 заголовков = 513 статусов (RULES § 3.20), Fixed 229 (включая
   «Fixed (частично)»), Open 270.
3. **Полный `pnpm test` прошёл с первого раза** после исправления типов;
   падений, связанных с `applyToolAsync`, не было.
4. **Интерфейс и исполнитель не менялись.** `IMediaProvider.applyToolAsync`
   уже обязателен для всех провайдеров, а `MediaNodeExecutor.executeToolAsync`
   вызывает его через `resolveToolTargetAsync` для любого провайдера
   (`src/media/media-node-executor.service.ts`). Правок в интерфейсе и
   исполнителе не потребовалось.

## 4. Smoke

### 4.1. Локальный multipart-запрос (реальный `fetch`)

Поднят локальный `node:http`-сервер на `127.0.0.1`, доступный по имени
`localtest.me` (оно резолвится в loopback). Провайдер реально скачал
изображение и отправил форму; сервер записал Content-Type и тело запроса.
Результат:

    {
      "calls": [
        { "method": "GET", "url": "/photo.png" },
        { "method": "POST", "url": "/v1/images/edits" }
      ],
      "editContentType": "multipart/form-data; boundary=----formdata-undici-014887223359",
      "boundaryPresent": true,
      "fields": {
        "model": true,
        "prompt": true,
        "imagePart": true,
        "size": true,
        "imageBytesPresent": true
      },
      "result": {
        "status": "done",
        "model": "gpt-image-1",
        "resultUrls": [
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        ]
      }
    }

Проверено: ровно 2 запроса (скачивание + редактирование), `Content-Type` —
`multipart/form-data` с boundary, есть части `image` (`filename="input.png"`,
`Content-Type: image/png`), `prompt`, `model=gpt-image-1` и `size`, байты
изображения присутствуют в теле.

### 4.2. Юнит-тесты

`openai-images.provider.spec.ts` (23 теста) дополнительно проверяет:

- ответ `b64_json` → `data:image/png;base64,...`;
- ответ `url` → URL как есть (тот же `toTaskResult`);
- `bg_removal` → промпт «Remove the background…» и параметры `size/quality`;
- повтор с тем же `idempotencyKey` не скачивает и не редактирует второй раз;
- `trim`/`lipsync`/`chromakey` и модель `dall-e-3` отвергаются до сети;
- не-http ссылка и приватный IP (`127.0.0.1`) отвергаются до `fetch`;
- 404 при скачивании — ошибка без POST в `/images/edits`;
- `Content-Length > 25 МБ` — ошибка без POST.

### 4.3. Ограничение smoke

Реальный платный вызов OpenAI не выполнялся: в окружении нет гарантированно
валидного ключа. Локальный smoke использует настоящий `fetch` и настоящий
`OpenAiImagesProvider`, поэтому форма запроса проверена на уровне байтов, а не
только на уровне мока.

## 5. Что не так

1. **DNS rebinding остаётся.** `assertSafeToolInputUrl` проверяет
   metadata/локальные имена и приватные IP-литералы, но DNS-резолв делает уже
   `fetch`. `localtest.me` из smoke — наглядное подтверждение: имя резолвится в
   loopback и проходит проверку. Полное закрытие — KI-525 (нужен бинарный
   метод в `SafeHttpClient` с pinned DNS).
2. **Редиректы запрещены полностью** (`redirect: 'error'`). Это закрывает
   обход SSRF через `Location`, но ломает легитимные CDN-ссылки, которые
   отвечают 301/302. Пользователь получит «не удалось скачать входное
   изображение».
3. **Поддержаны только `upscale` и `bg_removal`.** Для `trim`, `lipsync` и
   `chromakey` — явная ошибка. Это честно (OpenAI Images не работает с видео и
   не имеет модели хромакея), но операция `image_tool` с такими значениями
   для выбранной OpenAI-модели не выполнится.
4. **`dall-e-3` в каталоге генерации, но не в `/images/edits`.** Метод
   отвергает его до платного запроса; `dall-e-2` разрешён, хотя в каталоге
   провайдера его нет.
5. **`n` принудительно равен 1.** Узел сохраняет первый URL; множественные
   результаты (`n > 1`) не поддержаны, даже если пользователь передал `n` в
   параметрах.
6. **Нет маски и мульти-изображений.** `/images/edits` умеет `mask` и массив
   `image`, но текущий контракт `ImageToolParams` их не описывает.
7. **Идемпотентность остаётся в памяти процесса** (как у остальных прямых
   провайдеров, KI-381): рестарт или второй инстанс дубль не поймает.
8. **Нет живого платного теста.** `openai-images.integration.spec.ts` не
   дополнен `applyToolAsync`, потому что для него нужен публичный входной файл
   и ключ; в CI это было бы пропущено, как и остальные live-тесты.

## 6. Новые KI

- **KI-525 — Скачивание входа OpenAI Images без pinning DNS.** 🟡 Medium,
  Open. `applyToolAsync` защищён от metadata/локальных имён, приватных
  IP-литералов, учётных данных и редиректов, но DNS-резолв выполняет `fetch`,
  поэтому окно DNS rebinding остаётся. Решение — бинарный метод в
  `SafeHttpClient` с pinned DNS и лимитом байт. Файл:
  `src/media/providers/openai-images.provider.ts`.

Других новых проблем не найдено. Дубли KI-523/KI-524 — не новая проблема
реестра, а следствие ручного добавления записей; они удалены в этом пакете.

## 7. Обоснование решений

1. **Почему `fetch`, а не OpenAI SDK.** Провайдер с R7.3 построен на `fetch`,
   чтобы URL и тело были видны в логе; SDK не даёт ничего, кроме обёртки, и
   скрывает фактический запрос. Для multipart `fetch` поддерживает `FormData`
   нативно, а SDK добавил бы вторую реализацию загрузки файла.
2. **Почему скачивание в буфер.** `/v1/images/edits` не принимает ссылку:
   ему нужен файл в `multipart/form-data`. Буфер — минимальный способ передать
   байты, не заводя временных файлов и не расширяя контракт
   `IMediaProvider.applyToolAsync` (он по-прежнему получает URL).
3. **Почему `FormData` и Blob.** Стандартные `FormData`/`Blob` выставляют
   корректный `Content-Type` с boundary; ручная сборка multipart — источник
   ошибок `400 Invalid multipart`. `Content-Type` не задаётся вручную, иначе
   boundary потеряется.
4. **Почему только `upscale`/`bg_removal`.** Это единственные операции из
   `image_tool`, которые являются редактированием изображения. `trim` и
   `lipsync` — видео, `chromakey` не имеет модели ни у одного провайдера
   (KI-418). Passthrough через генерацию (старое поведение KI-371) давал не
   апскейл, а «перерисуй по описанию»; это вводило пользователя в заблуждение.
5. **Почему `dall-e-3` отвергается до скачивания.** Модель не поддерживает
   `/images/edits`; иначе мы скачали бы файл, отправили платный запрос и
   получили 400. Ошибка до сети дешевле и понятнее.
6. **Почему лимит 25 МБ и проверка MIME.** Это лимит OpenAI на входное
   изображение. Проверяются и `Content-Length`, и фактический размер: chunked
   может не объявлять длину. MIME берётся из `Content-Type`, при
   `application/octet-stream` — из расширения URL; SVG/GIF отвергаются, чтобы
   не отправить upstream заведомо неподдерживаемый формат.
7. **Почему частичная SSRF-защита, а не `SafeHttpClient`.** `SafeHttpClient`
   отдаёт тело строкой (`toString('utf8')`) и испортил бы бинарный файл.
   Расширение его бинарным методом — отдельный срез (KI-525); в S2 закрыты
   дешёвые векторы и запрещены редиректы.
8. **Почему идемпотентность через существующую карту.** `createTaskAsync` уже
   хранит готовый результат по `idempotencyKey`; инструмент использует ту же
   карту, поэтому job-level retry не создаёт второе платное редактирование.
9. **Почему разбор ответа переиспользует `toTaskResult`.** У генерации и
   редактирования одинаковый контракт `{ data: [{ url | b64_json }] }`.
   Отдельный парсер разошёлся бы в обработке `url`/MIME/`taskId`.

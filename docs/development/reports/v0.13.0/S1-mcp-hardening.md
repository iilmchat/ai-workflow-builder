---
title: "S1: MCP Hardening & UI (KI-529, KI-530, KI-531, KI-532)"
date: 2026-11-02
version: v0.13.0
steps: [S1]
status: accepted
related_ki: [KI-529, KI-530, KI-531, KI-532, KI-533, KI-534, KI-535, KI-536]
related_adr: []
---

# Отчёт S1 — MCP Hardening & UI

**Статус:** реализовано; коммитов в этой сессии нет (`git add -A` не
использовался, `git add` не вызывался вовсе). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **102 файла passed /
3 skipped, 1478 passed / 18 skipped**, `pnpm --dir web test` — **50/50,
424/424**, `pnpm --dir web build` — успешно, `pnpm lint` — **0 errors /
2 warnings** (оба преэкзистующие на HEAD, см. § 5.13). Smoke: **9/9** на
настоящем дочернем mock-MCP через `stdio` (проверены env allowlist, cwd,
PATH, WARN и пустой allowlist).

**Точка старта.** HEAD `d4ce0fb` («docs: update PROMPT_CURRENT to v8.4 and
create DESIGN v0.13»), версия `0.12.0`, CI v0.12.0 зелёный. Источник —
`docs/development/v0.13/DESIGN_V013_FEATURES.md` v1.0, правила —
`docs/development/RULES.md` v1.10.0.

---

## 1. Файлы (+/−)

### 1.1 Env и конфигурация

| Файл | +/− | Что |
|---|---:|---|
| [src/config/env.schema.ts](../../../../src/config/env.schema.ts) | +30/−0 | `MCP_STDIO_ENV_ALLOWLIST` (строка, default `''`) и `MCP_STDIO_CWD` (default `./data/mcp`, `trim().min(1)`) в `McpEnvSchema`; JSDoc о границе allowlist и о том, что cwd — не песочница |
| [src/mcp/mcp.config.ts](../../../../src/mcp/mcp.config.ts) | +62/−1 | `env: z.record(z.string(), z.string()).optional()` в `McpStdioServerConfigSchema`; экспортирован `stdioCommandBase`; хелперы `readStringConfig` и `parseStdioEnvAllowlist` (список через запятую → `Set`, пустые/дубли отбрасываются) |
| [src/mcp/mcp.types.ts](../../../../src/mcp/mcp.types.ts) | +9/−0 | `MCP_STDIO_CWD_DEFAULT = './data/mcp'` — тот же дефолт, что в env-схеме, для тестов/smoke без `ConfigModule` |
| [.env.example](../../../../.env.example) | +8/−0 | `MCP_STDIO_ENV_ALLOWLIST=` и `MCP_STDIO_CWD=./data/mcp` с пояснением, что значения не логируются и что cwd — не песочница |

### 1.2 MCP-клиент

| Файл | +/− | Что |
|---|---:|---|
| [src/mcp/mcp-client.service.ts](../../../../src/mcp/mcp-client.service.ts) | +164/−14 | `isPidAlive`: `ESRCH` → `false`, `EPERM` → `true`, прочее → `false` (KI-532); `buildStdioEnv` — только имена из allowlist, значения из `env` сервера (приоритет) или `ConfigService`, без логирования значений (KI-529); `prepareStdioCwdAsync` — `mkdir(<MCP_STDIO_CWD>/<serverName>, { recursive: true })` до `spawn` (KI-530); `warnIfNotDocker` — WARN один раз на сервер, basename без `.exe` (`/usr/bin/docker` = Docker); `createTransport`/`createStdioTransport` стали `async` из-за `mkdir`; в лог — число env-переменных, не значения |

### 1.3 UI

| Файл | +/− | Что |
|---|---:|---|
| [web/src/components/nodes/AgentNode.tsx](../../../../web/src/components/nodes/AgentNode.tsx) | +10/−0 | Бейдж `LOCAL` в `<summary>` сервера при `transport === 'stdio'`; `data-agent-mcp-transport="stdio"` для теста/smoke (KI-531) |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +1/−0 | `node.agent.mcp.transport.stdio` = `LOCAL` |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +1/−0 | `node.agent.mcp.transport.stdio` = `LOCAL` |

### 1.4 Тесты

| Файл | +/− | Что |
|---|---:|---|
| [src/mcp/mcp.config.spec.ts](../../../../src/mcp/mcp.config.spec.ts) | +26/−0 | +1 тест: `env` принимается как `Record<string,string>`, отсутствует без значения, отвергает число/строку вместо объекта |
| [src/mcp/mcp-client.service.spec.ts](../../../../src/mcp/mcp-client.service.spec.ts) | +149/−0 | +3 теста: фильтрация env по allowlist + cwd-каталог; WARN о не-Docker один раз (переподключение не дублирует); `EPERM` → SIGKILL, `ESRCH` → без SIGKILL. `FakeStdioTransport.params` расширен `env`/`cwd`; тестовый cwd вынесен в `tmpdir`, чтобы не создавать `data/mcp` в рабочем дереве |
| [src/config/env.schema.spec.ts](../../../../src/config/env.schema.spec.ts) | +29/−0 | +2 теста: дефолты/значения `MCP_STDIO_ENV_ALLOWLIST` и `MCP_STDIO_CWD`, пустая строка → дефолт, пробельная cwd → ошибка; дефолты добавлены в общий `toMatchObject` |
| [web/src/components/nodes/AgentNode.spec.tsx](../../../../web/src/components/nodes/AgentNode.spec.tsx) | +33/−0 | +1 тест: бейдж `LOCAL` только у `stdio`-сервера (HTTP-сервер без бейджа) |

### 1.5 Документация

| Файл | +/− | Что |
|---|---:|---|
| [docs/development/reports/v0.13.0/S1-mcp-hardening.md](S1-mcp-hardening.md) *(new)* | — | этот отчёт |
| [docs/development/reports/README.md](../README.md) | +1 | строка отчёта v0.13.0 S1 |

**Итого:** 13 изменённых tracked-файлов — **+523 / −15**, плюс новый отчёт.
Крупнейшие: `mcp-client.service.ts` (+164/−14),
`mcp-client.service.spec.ts` (+149), `mcp.config.ts` (+62/−1).

Артефакты smoke (gitignored, не deliverable): `.smoke/mock-mcp-env-server.mjs`,
`.smoke/s313-mcp-env-smoke.ts`, `.smoke/s313-mcp-smoke.json`,
`.smoke/s313-mcp-smoke.log`, `.smoke/s313-backend-test.log`,
`.smoke/s313-web-test.log`.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** (exit 0) · `pnpm typecheck` — **0**
(exit 0) · `pnpm test` — **102 passed / 3 skipped (105), 1478 passed /
18 skipped (1496)** · `pnpm --dir web test` — **50/50, 424/424** ·
`pnpm --dir web build` — **успешно** · `pnpm lint` — **0 errors / 2 warnings**
(преэкзистующие, § 5.13). Прирост к HEAD: **+6 backend-тестов**
(`env.schema` 67→69, `mcp.config` 18→19, `mcp-client.service` 23→26) и
**+1 web-тест** (`AgentNode` 6→7).

---

## 3. Диагностика

### 3.1 Падений гейтов не было

На HEAD `d4ce0fb` рабочее дерево содержало только чужой `M RELEASE_NOTES.md`
(не мой файл, не трогал). `pnpm typecheck` прошёл с первой попытки;
`pnpm build` при успехе молчит (это `nest build`), поэтому критерий —
exit 0 и отсутствие вывода. Полные прогоны тестов и web-сборка также зелёные.

### 3.2 `MCP_STDIO_CWD` — `trim().min(1)`, а не просто `min(1)`

Первая версия схемы принимала строку из трёх пробелов: `z.string().min(1)`
считает длину до trim, и `'   '` прошла бы как валидный путь. Клиент
`readStringConfig` такой путь всё равно заменил бы дефолтом, но env-схема
обещала бы «валидное значение». Добавлен `.trim().min(1)`: пустая строка
(после `emptyToUndefined`) уходит в default, а пробельная — ошибка старта.
Тест закрепляет оба случая.

### 3.3 `createTransport` стал `async`

`fs.mkdir` для cwd — асинхронный; синхронный `mkdirSync` блокировал бы event
loop на каждом подключении (и особенно на реконнекте). Сигнатура
`createTransport(): Promise<Transport>` изменилась в одном месте вызова
(`connectAsync` уже `async`), поэтому каскада правок нет. Ошибка `mkdir`
(нет прав, путь занят файлом) попадает в общий `catch` `connectAsync` и
превращается в `McpUnavailableException` с причиной.

### 3.4 `ConfigService` вместо `process.env`

Первая реализация читала значения allowlist напрямую из `process.env`.
Это нарушает RULES 4.6 («`process.env.X` — всегда через `config.get`») и
делает юнит-тесты зависимыми от глобального окружения. Переписано на
`this.config.get<unknown>(name)`; в production `ConfigService` видит те же
переменные (включая не входящие в `EnvSchema` — `validateEnv` сохраняет
исходные ключи), а тесты передают значения через стаб конфигурации.
Smoke тоже стал передавать «окружение backend'а» через `ConfigService`.
Значения по-прежнему не логируются.

### 3.5 Контракт `FakeStdioTransport`

Фейк транспорта в спеке повторяет только используемые поля. Новые `env` и
`cwd` добавлены в тип `params` и в конструктор, иначе TypeScript не дал бы
проверить их в тесте. Реальный SDK (`@modelcontextprotocol/sdk` 1.32.1)
мержит переданный `env` с безопасным `getDefaultEnvironment()`
(`PATH`/`HOME`/`SYSTEMROOT`/…), а `cwd` передаёт прямо в `spawn` — smoke
подтверждает оба факта на дочернем процессе.

### 3.6 WARN о не-Docker — один раз на сервер

`warnIfNotDocker` вызывается при создании транспорта, то есть на каждом
подключении. Без защиты реконнект после сетевого сбоя повторял бы одну и ту
же строку. Добавлен `Set<string> warnedNonDocker` (по имени сервера):
WARN печатается при первом подключении конкретного сервера в процессе.
Сравнение — по `stdioCommandBase` (basename, нижний регистр, без
`.exe/.cmd/.bat/.ps1`), поэтому `C:\...\docker.exe` и `/usr/bin/docker` не
дают ложного предупреждения.

### 3.7 Тестовый cwd — в `tmpdir`, а не в репозитории

После появления `mkdir` все существующие stdio-тесты начали бы создавать
`./data/mcp/<server>` в рабочем дереве. В `BASE_CONFIG` добавлен
`MCP_STDIO_CWD = join(tmpdir(), 'workflow-builder-mcp-tests')`; тест
allowlist использует собственный `mkdtemp` и удаляет его в `finally`.
`data/` и так в `.gitignore`, но тест не должен оставлять следов.

### 3.8 `vi.stubEnv` не откатывается `restoreAllMocks`

Промежуточный вариант теста использовал `vi.stubEnv`; выяснилось, что
`vi.restoreAllMocks()` не снимает env-стабы (для них есть
`vi.unstubAllEnvs`). После перехода на `ConfigService` стабы не нужны вовсе,
поэтому тест не зависит от глобального `process.env`.

### 3.9 Lint

`pnpm lint` — 0 errors, 2 warnings `typescript(no-base-to-string)` в
`src/media/providers/openai-images.provider.spec.ts` (строки 567 и 588).
Проверено: предупреждения были на HEAD и к S1 отношения не имеют (тот же
вывод зафиксирован в отчёте v0.12.0 S3-S4).

---

## 4. Smoke

### 4.1 Стенд

Окружение: Windows 11 (10.0.22631), Node `v24.21.0`, pnpm `12.14.0`.
Команда: `pnpm exec tsx .smoke/s313-mcp-env-smoke.ts`.
Mock-сервер: `.smoke/mock-mcp-env-server.mjs` — настоящий дочерний процесс,
JSON-RPC 2.0 по stdin/stdout (`initialize` → `tools/list` → `tools/call`).
Инструмент `inspect` возвращает **изнутри процесса**: `cwd`, PID, значения
`WB_SMOKE_TOKEN` / `WB_SMOKE_EXPLICIT` / `WB_SMOKE_SECRET` и наличие `PATH`.

Два сценария:

1. `MCP_STDIO_ENV_ALLOWLIST="WB_SMOKE_TOKEN, WB_SMOKE_EXPLICIT"`;
   `WB_SMOKE_TOKEN` есть в окружении backend'а, `WB_SMOKE_EXPLICIT` задан в
   `env` сервера (должен победить), `WB_SMOKE_SECRET` задан и в окружении, и
   в JSON (не должен попасть).
2. `MCP_STDIO_ENV_ALLOWLIST=""`; в `env` сервера задан `WB_SMOKE_EXPLICIT` —
   не должен попасть даже он.

### 4.2 Результат — 9/9

```json
{
  "smoke": "v0.13 S1 — MCP stdio env allowlist + cwd isolation",
  "mock": "D:\\Projects\\AI\\workflow-builder\\.smoke\\mock-mcp-env-server.mjs",
  "checks": [
    {
      "name": "stdio: tools/list отвечает через настоящий дочерний процесс",
      "passed": true,
      "tools": ["inspect"]
    },
    {
      "name": "stdio: cwd дочернего процесса = <MCP_STDIO_CWD>/<server>",
      "passed": true,
      "expectedCwd": "C:\\Users\\73B5~1\\AppData\\Local\\Temp\\wb-mcp-smoke-awA19s\\shadow",
      "actualCwd": "C:\\Users\\73B5~1\\AppData\\Local\\Temp\\wb-mcp-smoke-awA19s\\shadow"
    },
    {
      "name": "stdio: каталог изоляции создан до запуска процесса",
      "passed": true,
      "path": "C:\\Users\\73B5~1\\AppData\\Local\\Temp\\wb-mcp-smoke-awA19s\\shadow"
    },
    {
      "name": "stdio: env allowlist — значение из окружения backend доходит до процесса",
      "passed": true,
      "value": "from-process"
    },
    {
      "name": "stdio: явный env сервера побеждает окружение backend",
      "passed": true,
      "value": "from-config"
    },
    {
      "name": "stdio: env вне allowlist не попадает в процесс (ни из JSON, ни из backend)",
      "passed": true,
      "value": null
    },
    {
      "name": "stdio: безопасный env SDK (PATH) наследуется",
      "passed": true,
      "pathInherited": true
    },
    {
      "name": "stdio: не-Docker команда даёт WARN",
      "passed": true,
      "sample": [
        "MCP-сервер 'shadow': stdio-команда 'C:\\Program Files\\nodejs\\node.exe' запускается без Docker. Рекомендуется docker run: процесс получает права backend-процесса (DESIGN v0.13 § 3.2, KI-530)"
      ]
    },
    {
      "name": "stdio: пустой allowlist не пропускает даже явный env сервера",
      "passed": true,
      "env": {
        "WB_SMOKE_TOKEN": null,
        "WB_SMOKE_EXPLICIT": null,
        "WB_SMOKE_SECRET": null
      }
    }
  ],
  "summary": { "total": 9, "passed": 9, "failed": 0 }
}
```

### 4.3 Лог стенда (фрагмент)

WARN перехвачен smoke'ом (чтобы не смешивать с JSON) и показан в check выше.
Остальной лог — доказательство того, что процесс реально запущен и cwd
применён:

```text
[Nest] LOG [McpServerRegistry] MCP включён: серверов в реестре — 1, stdio разрешён
[Nest] LOG [McpClientService] MCP-сервер 'shadow': stdio-процесс C:\Program Files\nodejs\node.exe (аргументов: 1, cwd: C:\Users\73B5~1\AppData\Local\Temp\wb-mcp-smoke-awA19s\shadow, env-переменных: 2)
[Nest] DEBUG [McpClientService] MCP-сервер 'shadow' stderr: [mock-mcp-env] started pid=34700
[Nest] LOG [McpClientService] MCP-сервер 'shadow' подключён (транспорт: stdio)
[Nest] LOG [McpClientService] MCP-сервер 'shadow': каталог получен, инструментов — 1
[Nest] LOG [McpClientService] MCP shadow/inspect: вызов выполнен за 4 мс
[Nest] DEBUG [McpClientService] MCP-сервер 'shadow': stdio-процесс 34700 — SIGTERM
[Nest] LOG [McpServerRegistry] MCP включён: серверов в реестре — 1, stdio разрешён
[Nest] LOG [McpClientService] MCP-сервер 'noallow': stdio-процесс C:\Program Files\nodejs\node.exe (аргументов: 1, cwd: C:\Users\73B5~1\AppData\Local\Temp\wb-mcp-smoke-awA19s\noallow, env-переменных: 0)
```

### 4.4 Что доказывает прогон

- `cwd` дочернего процесса — ровно `<MCP_STDIO_CWD>/<serverName>`, а не
  каталог backend'а; каталог существует к моменту `spawn` (проверено
  `stat`).
- В процесс попало ровно 2 разрешённых имени (`env-переменных: 2`), а при
  пустом allowlist — 0; `WB_SMOKE_SECRET` отсутствует в обоих сценариях,
  хотя был и в окружении backend'а, и в JSON.
- Явный `env` сервера имеет приоритет над окружением, но не обходит
  allowlist.
- SDK по-прежнему передаёт безопасный набор (`PATH`), то есть allowlist не
  «отрезает» процесс от системных переменных, нужных `node`/`docker`.
- Не-Docker команда даёт WARN; повторное подключение не дублирует его
  (проверено юнит-тестом).

### 4.5 Что smoke **не** покрывает

- Docker-изоляцию: проверялся `node`, а не `docker run`; WARN — только
  сигнал, не песочница.
- Реальный сторонний MCP-сервер: mock повторяет протокол, но не чужую
  реализацию.
- Linux/macOS: проверено на Windows; `EPERM`/`ESRCH` для настоящего
  чужого процесса не воспроизводились (только юнит-тест с моком
  `process.kill`).
- Злонамеренный сервер, который читает `/etc/passwd` по абсолютному пути:
  cwd-изоляция этого не предотвращает (см. § 5.1).

---

## 5. Что не так

1. **cwd-изоляция — не песочница.** Процесс по-прежнему имеет права
   backend'а, доступ к абсолютным путям, сети и переменным, которые ему
   передали. KI-530 закрыт частично: относительные пути больше не указывают
   в каталог backend'а, добавлен WARN про Docker, но реальная изоляция —
   только `docker run` (DESIGN v0.12 § 3.3.3). Это осознанно, но оператор
   должен понимать границу.
2. **Allowlist глобальный, а не по серверу.** Если в `MCP_SERVERS` два
   stdio-сервера и в allowlist есть `GITHUB_TOKEN`, его получит **каждый**
   сервер, а не только тот, которому он нужен. Закрывается только
   per-server политикой (новый KI-533).
3. **Опечатка в имени allowlist молчит.** `MCP_STDIO_ENV_ALLOWLIST=GITHUB_TOKENS`
   (лишняя `S`) — валидная строка, сервер стартует, переменная не передаётся,
   а ошибка вылезет позже как «нет доступа» на стороне MCP-сервера. Нет ни
   проверки шаблона имени, ни WARN о не найденном имени (KI-534).
4. **Секреты в `env` сервера — это plaintext JSON.** Allowlist ограничивает
   имена, но не делает значения из `MCP_SERVERS` секретами: они видны в
   конфиг-дампах. Для секретов предназначен именно путь «имя в allowlist +
   значение в окружении backend'а»; это задокументировано в `.env.example`.
5. **Дефолт `MCP_STDIO_CWD=./data/mcp` относителен.** Если backend запущен
   не из корня репозитория (неверный `WorkingDirectory` в systemd/Планировщике),
   каталоги создадутся в другом месте. Абсолютный путь допустим, но не
   проверяется и не канонизируется (KI-536).
6. **WARN о не-Docker — только в момент первого подключения.** Если сервер
   описан, но ни один запуск его не коснулся, предупреждения в логе не будет
   (KI-535). Перенос в старт реестра — улучшение, не входившее в S1.
7. **`isPidAlive` трактует «прочие» ошибки как «мёртв».** Это ровно
   требование KI-532 (`ESRCH` → false, `EPERM` → true, иначе false), но
   экзотический код (например, `EINVAL`) теоретически может означать живой
   процесс — тогда SIGKILL не отправится. Для собственного дочернего
   процесса риск низкий.
8. **`process.kill(pid, 0)` остаётся subject to PID-reuse.** Между проверкой
   и `SIGKILL` PID теоретически может достаться другому процессу; окно
   маленькое, но не нулевое. Полностью решается только хранением
   `ChildProcess`/job-object, чего SDK не отдаёт.
9. **Бейдж `LOCAL` есть только в `AgentNode`.** API уже отдаёт `transport`,
   но другие места (история запусков, каталог MCP вне узла) транспорт не
   показывают. Задача S1 ограничена узлом `agent`.
10. **`LOCAL` одинаков в ru/en.** Это осознанно: бейдж — техническая метка
    протокола, как `RO`/`DESTR`, а не локализуемое слово. Если продукт
    захочет «ЛОКАЛЬНЫЙ», это одна строка i18n.
11. **CHANGELOG и KNOWN_ISSUES не обновлены.** Промпт S1 требует только
    отчёт; закрытие KI-529…532 и записи KI-533…536 — это docs-шаг S2/релиза
    (RULES 3.17, 2.12). В реестре KI-529…532 остаются `Open` до него.
12. **Ссылка на отчёт в CHANGELOG не добавлена** (RULES 2.18) по той же
    причине: `CHANGELOG.md` — релизный файл S2, а не файл этой сессии.
    `reports/README.md` обновлён.
13. **`pnpm lint` — 2 предупреждения, но они не мои.** Оба —
    `typescript(no-base-to-string)` в `openai-images.provider.spec.ts`
    (строки 567, 588); проверено сравнением с HEAD, к S1 отношения не имеют.
    Ошибок 0, гейт `lint` в задании не требовался.
14. **Полный `pnpm build` собирает только backend.** Web проверен отдельно
    `pnpm --dir web build` (успешно) и полным `pnpm --dir web test`
    (424/424), иначе UI-правка осталась бы вне гейта.
15. **Тестовый cwd общий на файл спеки.** `TEST_STDIO_CWD` — один путь в
    `tmpdir` на все stdio-тесты файла; `mkdir(..., { recursive: true })`
    делает параллельные вызовы безопасными, но каталоги не удаляются после
    прогона (в отличие от теста allowlist с `mkdtemp`/`rm`).
16. **Smoke-стенд — Windows-only и Node-only.** POSIX-семантика
    `SIGTERM`/`EPERM` и Docker-путь не гонялись; это зафиксировано в § 4.5.
17. **`MCP_STDIO_ENV_ALLOWLIST` не влияет на HTTP/SSE-серверы.** Это
    ожидаемо (заголовки задаются `headers`/`tokenEnv`), но оператору легко
    перепутать: одна переменная называется «stdio», вторая — общая `MCP_*`.
    В `.env.example` оба блока стоят рядом с пояснением.

---

## 6. Новые KI

Ниже — предлагаемые записи (нумерация после KI-532; в
`docs/KNOWN_ISSUES.md` не вставлены — это S2/релиз, RULES 2.12/3.17).

### KI-533 — Глобальный `MCP_STDIO_ENV_ALLOWLIST` отдаёт все разрешённые env всем stdio-серверам

- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp-client.service.ts`, `src/config/env.schema.ts`
- **Описание:** allowlist один на процесс. При двух и более stdio-серверах
  каждый получает **все** имена из списка, которые есть в окружении, даже
  если они нужны только одному серверу. Скомпрометированный/ошибочный сервер
  получает токены соседей. Это следствие дизайна v0.13 § 3.1, а не ошибка
  реализации, но границу стоит сузить.
- **Предлагаемое решение:** per-server `envAllowlist` в `MCP_SERVERS`
  (пересечение с глобальным), либо явное правило «один секрет — один
  stdio-сервер» в USER_GUIDE с проверкой на старте.

### KI-534 — Опечатка/неизвестное имя в `MCP_STDIO_ENV_ALLOWLIST` не диагностируется

- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp.config.ts`, `src/mcp/mcp-client.service.ts`
- **Описание:** `parseStdioEnvAllowlist` принимает любое непустое имя.
  Если переменной нет в окружении и в `env` сервера, она молча
  пропускается; сервер стартует без токена и падает позже невнятной
  ошибкой. Нет ни regex-валидации имён, ни WARN «allowlist содержит N имён,
  из них M не найдено».
- **Предлагаемое решение:** валидировать имена
  (`^[A-Za-z_][A-Za-z0-9_]*$`) в env-схеме и логировать WARN со списком
  **имён** (не значений) при подключении, если имя не разрешилось.

### KI-535 — WARN «stdio без Docker» появляется только при первом подключении

- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp-client.service.ts`, `src/mcp/mcp-server.registry.ts`
- **Описание:** предупреждение печатается в `createStdioTransport`, то есть
  при первом реальном обращении к серверу. Если сервер описан, но не
  используется, оператор не увидит рекомендацию при старте — ровно тогда,
  когда её проще всего заметить.
- **Предлагаемое решение:** продублировать WARN на старте реестра (обход
  `listServers()` при `MCP_ENABLE_STDIO=true`), оставив проверку в клиенте
  как защиту от подмены конфигурации.

### KI-536 — `MCP_STDIO_CWD` не канонизируется и не проверяется на абсолютность

- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/config/env.schema.ts`, `src/mcp/mcp-client.service.ts`
- **Описание:** дефолт относителен (`./data/mcp`). При запуске backend'а из
  другого рабочего каталога (`WorkingDirectory`, `pm2`, Планировщик) база
  изоляции окажется не там, где ожидает оператор; путь с симлинком тоже не
  разрешается. В лог попадает относительный путь, что затрудняет диагностику.
- **Предлагаемое решение:** резолвить `MCP_STDIO_CWD` в абсолютный путь при
  создании клиента (`path.resolve`) и логировать его один раз на старте;
  опционально — предупреждать, если путь вне каталога данных приложения.

---

## 7. Обоснование решений

1. **Allowlist фильтрует и имена, и значения, а не «добавляет поверх
   `process.env`».** Формулировка DESIGN § 3.1 допускает прочтение
   «передать `{ ...process.env, ...config.env }`, но только ключи из
   allowlist». Передать весь `process.env` нельзя: тогда любой stdio-сервер
   получает все секреты backend'а, а allowlist становится декоративным.
   Реализовано строго: итоговый объект содержит **только** имена из
   allowlist; значение берётся из `env` сервера (приоритет) или из
   окружения. Это и проверяет smoke: `WB_SMOKE_SECRET` отсутствует, хотя
   задан в обоих источниках.
2. **`env` в схеме сервера оставлен, хотя allowlist глобален.** Это точка
   расширения для per-server значений (режим, путь, несекретный флаг) и
   задел под KI-533. Секреты в JSON класть не рекомендуется: JSON виден в
   конфиг-дампах, а allowlist — только фильтр имён, не шифрование.
3. **Политика — в клиенте, форма — в Zod.** `McpStdioServerConfigSchema`
   проверяет, что `env` — `Record<string,string>`; решение, какие имена
   доходят до процесса, принимает клиент в момент запуска. Схема остаётся
   чистой функцией формы (как `parseMcpServersConfig` с `enableStdio`), а
   политика не размазывается по парсеру JSON.
4. **`ConfigService`, а не `process.env`.** RULES 4.6 требует читать env
   через DI; кроме того, это единственный способ протестировать allowlist
   без глобальных мутаций `process.env` (которые протекают между тестами).
   `ConfigService` в Nest видит и переменные вне `EnvSchema`, потому что
   `validateEnv` возвращает `{ ...config, ...result.data }`.
5. **cwd создаётся до `spawn`, а не лениво.** SDK вызывает `spawn` внутри
   `client.connect`, и несуществующий `cwd` — ошибка `ENOENT` на старте
   процесса. `mkdir(..., { recursive: true })` идемпотентен (реконнект,
   параллельные серверы) и не требует предварительной миграции каталогов.
6. **`createTransport` стал `async`, а не `mkdirSync`.** Синхронный FS в
   `connectAsync` блокировал бы весь event loop на время дисковых операций;
   асинхронная версия сохраняет конкурентность и позволяет естественно
   пробросить ошибку в общий `catch`. Изменение локальное: единственный
   вызов уже был в `async`-методе.
7. **Отдельный cwd на сервер, а не общий `./data/mcp`.** Общий каталог
   свёл бы изоляцию к нулю: серверы видели бы файлы друг друга по
   относительным путям. `<base>/<serverName>` даёт каждому свой корень;
   имя сервера уже ограничено `^[a-z][a-z0-9_-]{0,23}$`, поэтому `..` и
   разделители путей невозможны — дополнительная проверка не нужна.
8. **WARN один раз на сервер.** Предупреждение — про политику запуска, а не
   про конкретную попытку; повторять его на каждом реконнекте значит
   превратить важный сигнал в шум. `Set` по имени сервера решает это без
   глобального состояния. `stdioCommandBase` переиспользован из denylist'а,
   чтобы `/usr/bin/docker` и `docker.exe` не считались «не-Docker».
9. **`isPidAlive`: `EPERM` → `true`, остальное → `false`.** Это буквально
   требование KI-532. `EPERM` означает «процесс есть, сигнал запрещён»,
   поэтому попытку `SIGKILL` надо сделать (она тоже может не сработать, но
   это уже вопрос прав, а не существования). `ESRCH` — единственный
   надёжный признак «мёртв»; прочие коды консервативно считаем «мёртв»,
   чтобы не убить чужой PID при reuse.
10. **Бейдж — в `<summary>`, рядом со статусом.** Пользователь видит
    транспорт там же, где имя сервера и статус, без раскрытия `<details>`;
    `data-agent-mcp-transport` даёт стабильную точку для теста, не завязывая
    его на CSS-классы. Условие строго `transport === 'stdio'`: `http`/`sse`
    не получают бейдж, чтобы не размечать «нормальный» транспорт.
11. **i18n-ключ, а не литерал `LOCAL` в JSX.** Оба файла (`ru`, `en`)
    обновлены синхронно — иначе `i18n.spec.ts` падает на паритете ключей.
    Значение `LOCAL` одинаково для обоих языков осознанно: это техническая
    метка, как `RO`/`DESTR`.
12. **Тесты — на фейковом транспорте, smoke — на реальном процессе.**
    Юнит-тесты проверяют наш код (фильтрацию, cwd, WARN, shutdown) без
    запуска процессов; smoke проверяет то, что юнит-тест подменить не может:
    реальный `spawn`, реальный `process.cwd()` и реальное окружение
    дочернего процесса. Оба уровня нужны: первый быстрый и детерминированный,
    второй ловит ошибки контракта SDK (`env` мержится с safe-env, а не
    заменяет его).
13. **Тестовый cwd — `tmpdir`.** Иначе каждый прогон создавал бы
    `data/mcp/*` в рабочем дереве, а тест allowlist — ещё и временные
    каталоги, которые никто не убирает. `mkdtemp` + `rm` в `finally` дают
    чистый прогон и проверяют реальное создание каталога.
14. **`.env.example` обновлён, CHANGELOG/KNOWN_ISSUES — нет.** Первый —
    операторская документация новой переменной, без неё фичу невозможно
    включить осознанно. Вторые — релизные файлы S2: закрытие KI требует
    точечных diff'ов (RULES 2.12), а вставка новых KI — отдельного шага,
    чтобы не смешивать код S1 и релизную нумерацию.

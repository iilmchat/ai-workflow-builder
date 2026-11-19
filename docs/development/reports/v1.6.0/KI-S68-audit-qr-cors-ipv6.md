---
title: "KI-спринт 68: аудит, QR, CORS и IPv6"
date: 2026-11-19
version: v1.6.0
steps: [S68]
status: done
related_ki: [KI-616, KI-665, KI-668, KI-669]
---

# KI-спринт 68 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/audit/audit.interceptor.ts` | +2 — `collaborator.invite` в маскируемые действия |
| `web/src/hooks/useQrScanner.ts`, `useQrScanner.spec.ts`, `TopBar.tsx`, i18n ru/en | +18 / −5 — `QrUnavailableException` и тост |
| `src/config/cors.ts`, `cors.spec.ts` | +10 / −6 — prod-like CORS |
| `src/metrics/metrics-ip-allowlist.ts`, `.spec.ts` | +55 / −6 — IPv6-CIDR через BigInt |
| `docs/KNOWN_ISSUES.md`, `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `reports/README.md` | статусы и сводки |

## 2. Build / test

`pnpm build` — 0/0; backend 2163 passed; web build 0/0 и 651 тест;
гейты реестра и Grafana зелёные. Два transient-падения в параллельных
прогонах не воспроизвелись при повторе.

## 3. Диагностика

- **KI-616:** PII-политика применялась только к действиям участников — приглашение
  collaborators писало email открытым текстом.
- **KI-665:** `scanQr()` возвращал `null` и для отмены, и для отсутствия GMS —
  UI не мог отличить их и молчал.
- **KI-668:** staging/preprod оставались с `origin: true` (отражать любой Origin).
- **KI-669:** IPv6-CIDR отбрасывался, хотя точные IPv6-адреса работали.

## 4. Smoke

Тесты: QR при отсутствии камеры/GMS/разрешения → `QrUnavailableException`;
CORS staging с пустым списком блокирует старт; `fe80::/10` пускает `fe80::1`,
но не `fec0::1`. i18n-ключ добавлен в оба файла (RULES 1.14).

## 5. Что не так

- Примечание: `check-known-issues` не проверяет строки сводки для статусов,
  которых нет в факте (например, Open = 0) — зафиксировано для S69-Final.

## 6. Новые KI

Не заведено (находка из § 5 будет оформлена в S69-Final, если подтвердится).

## 7. Обоснование решений

Все четыре правки точечные и не меняют публичные контракты, кроме CORS в
prod-like средах — там отказ при пустом allowlist осознан (KI-221). IPv6-CIDR
реализован на `BigInt` без внешней зависимости.

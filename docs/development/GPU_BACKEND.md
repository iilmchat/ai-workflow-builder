# GPU Inference Backend (LM Studio via Reverse SSH)

**Дата:** 2026-11-06
**Статус:** Паттерн валидирован на VetAssistant, адаптирован для AI Workflow Builder.

## 1. Суть
Рабочая станция с GPU (Windows + LM Studio) выступает общим inference-бэкендом для контейнеров на сервере. Прямой вход на ПК заблокирован, поэтому используется обратный SSH-туннель (`ssh -R`), который пробрасывает локальный порт LM Studio (8034) на Docker bridge gateway (172.x.0.1) сервера.

## 2. Настройка для AI Workflow Builder (primary 89.108.70.62)

### Шаг 1. На сервере (primary)
1. В `sshd_config` должно быть: `GatewayPorts clientspecified`.
2. Открыть порт в ufw для docker-бриджа:
   ```bash
   ufw allow in on br-xxxx to 172.18.0.1 port 8035 proto tcp
   ```
3. В `.env` бэкенда добавить:
   ```env
   LMSTUDIO_BASE_URL=http://172.18.0.1:8035/v1
   LMSTUDIO_API_KEY=<токен_из_LM_Studio>
   LMSTUDIO_MODELS=qwen/qwen2.5-coder-7b-instruct:text
   ```
4. Перезапустить контейнер: `docker compose restart app`.

### Шаг 2. На ПК (Windows)
1. В скрипте `wg-gpu-tunnel.ps1` добавить туннель для primary:
   ```powershell
   ssh -N -R 172.18.0.1:8035:127.0.0.1:8034 root@89.108.70.62
   ```
2. Перезапустить Scheduled Task `WG-GPU-Tunnel`.

## 3. Проверка
Из контейнера бэкенда:
```bash
curl -H "Authorization: Bearer <токен>" http://172.18.0.1:8035/v1/models
```
Должен вернуться список моделей LM Studio.

В логах бэкенда (при старте) должно появиться:
`LM Studio: обнаружено N моделей`.

## 4. Ограничения
- Если ПК выключен, туннель падает, бэкенд выдаёт WARN и работает без LM Studio (graceful degradation).
- Порт 8035 выбран свободным (8034 занят VetAssistant на резерве).

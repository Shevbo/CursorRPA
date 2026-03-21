# Telegram ↔ Cursor Agent (bridge)

Бот принимает сообщения в Telegram, вызывает на **этом же сервере** [`rpa-agent.sh`](../../scripts/rpa-agent.sh) и возвращает ответ в чат.

**Пошагово для новичка:** [docs/telegram-bot-pilot-novice-ru.md](../../docs/telegram-bot-pilot-novice-ru.md).

## Пилот (удобство и стабильность)

- Задайте **`CURSOR_RPA_FIXED_WORKSPACE`** — режим «1 бот = 1 проект», без `/project`.
- **`TELEGRAM_ALLOWED_USER_IDS`** обязателен в проде (иначе бот открыт для всех).
- В одном Telegram-чате запросы к агенту **не параллелятся**: новый текст ждёт или получает подсказку подождать.
- Пока идёт вызов агента, бот шлёт **«печатает…»** периодически.
- Длинные ответы режутся на части **`[1/N] …`** с лимитом `TELEGRAM_MESSAGE_MAX_CHARS`.
- При ненулевом коде выхода агента ответ помечается **`⚠️ Код агента …`**.
- Команды: **`/help`**, **`/ping`** (проверка путей), **`/status`** (очередь свободна/занята).

## Быстрый старт на сервере (dev-rpa)

1. Установите Python 3.10+ и venv:
   ```bash
   sudo apt-get update && sudo apt-get install -y python3-venv
   ```
2. Скопируйте каталог `services/telegram-bridge` на сервер (или весь репозиторий).
3. В каталоге моста:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cp config.example.env .env
   nano .env   # TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS, пути
   ```
4. Запуск вручную:
   ```bash
   source .venv/bin/activate
   set -a && source .env && set +a
   python bot.py
   ```
5. В Telegram: `/start` → `/project myapp` → `/newchat Создай каркас Android-проекта...` → дальше обычные сообщения как промпты.

## systemd

Пример юнита: [`cursor-telegram-bridge.service.example`](systemd/cursor-telegram-bridge.service.example) — скопируйте в `/etc/systemd/system/`, поправьте пути и пользователя, `sudo systemctl daemon-reload && sudo systemctl enable --now cursor-telegram-bridge`.

## Переменные окружения

См. [`config.example.env`](config.example.env).

## Состояние

`~/.config/cursor-rpa/telegram_bridge_state.json` — привязка Telegram-пользователя к workspace и `cursor_chat_id`.

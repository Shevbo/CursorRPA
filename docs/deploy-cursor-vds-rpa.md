# Развёртывание Cursor Agent CLI для RPA: dev-VM (VHDX) и VDS

Цель: подготовить окружение, где **RPA-сервис** (отдельная реализация) вызывает **Cursor Agent CLI** (`agent`) с параметрами **проект (workspace)**, **чат**, **промпт**, **код команды** — в духе работы с агентом Cursor в нескольких проектах.

Официальные материалы: [Headless CLI](https://cursor.com/docs/cli/headless), [Параметры CLI](https://cursor.com/docs/cli/reference/parameters), [Authentication](https://cursor.com/docs/cli/reference/authentication).

---

## Кто что делает

| Маркер | Смысл |
|--------|--------|
| **Вы** | Действия на своей машине/VM/VDS: SSH, sudo, ввод секретов, заказ тарифа, копирование команд. |
| **Ассистент** | По вашим логам и вопросам: правит скрипты, unit-файлы, чеклисты, файл [context-vds-cursor-rpa.md](context-vds-cursor-rpa.md), разбирает ошибки. |

---

## Локальная VM vs VDS

- **Dev:** диск `ubuntu-24.04.2-server.vhdx` (или аналог) — здесь отлаживаете установку, пути, RPA-обёртку.
- **VDS:** чистая **Ubuntu Server 24.04 LTS** (или 22.04) с ISO хостинга; перенос **не** через клон VHDX, а через **повтор тех же шагов** и сверку версий (этап паритета ниже).
- Перенос образа **VHDX** на KVM-VDS «как есть» часто **невозможен** без конвертации и поддержки импорта у провайдера; выбранная стратегия — **воспроизводимая настройка**.

---

## Этап 0 — Dev-VM: установка и настройка Cursor Agent CLI

### 0.1 Сеть и доступ

**Вы:** убедитесь, что из VM есть исходящий HTTPS (фаервол, прокси, DNS).

### 0.2 Базовые пакеты

**Вы** на Ubuntu:

```bash
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates git jq
```

### 0.3 Установка Cursor Agent CLI

**Вы:**

```bash
curl https://cursor.com/install -fsS | bash
```

Откройте **новый** терминал или выполните `source ~/.bashrc` (или `~/.zshrc`), чтобы подхватить `PATH`.

Альтернатива: в репозитории есть скрипт [scripts/dev-setup-cursor-agent.sh](../scripts/dev-setup-cursor-agent.sh) — скопируйте на VM, `chmod +x` и запустите.

### 0.4 Аутентификация

**Вариант A (с браузером на той же машине):** `agent login` — см. [Authentication](https://cursor.com/docs/cli/reference/authentication).

**Вариант B (автоматизация / сервер без браузера):** ключ API — в дашборде Cursor раздел **Cloud Agents → User API Keys** (там же описано в документации).

**Вы:** получите ключ и задайте переменную (ниже).

Временно в сессии:

```bash
export CURSOR_API_KEY="ВАШ_КЛЮЧ"
```

Постоянно (пример): строка в `~/.bashrc` **или** файл, который подключаете только на серверах (не коммитьте в git):

```bash
# ~/.config/cursor-rpa/env.sh — права 600
export CURSOR_API_KEY="ВАШ_КЛЮЧ"
```

```bash
echo 'source ~/.config/cursor-rpa/env.sh' >> ~/.bashrc
chmod 600 ~/.config/cursor-rpa/env.sh
```

После любых правок в `~/.bashrc` проверьте синтаксис: `bash -n ~/.bashrc`. Если при входе в SSH видите `unexpected EOF while looking for matching`, ищите незакрытую кавычку в последних добавленных строках.

### 0.5 Проверка установки

**Вы:**

```bash
agent --version
agent status
agent about
```

При ошибках аутентификации — перепроверьте ключ и сеть.

### 0.6 Каталоги проектов (workspaces)

**Вы:** заведите стабильные пути, те же потом повторите на VDS, например:

```bash
sudo mkdir -p /srv/workspaces
sudo chown -R "$USER:$USER" /srv/workspaces
mkdir -p /srv/workspaces/project-a /srv/workspaces/project-b
```

Клонируйте репозитории в эти каталоги или синхронизируйте иным способом.

### 0.7 Первый запрос к агенту в каталоге проекта

**Вы** (подставьте путь; `--trust` нужен для headless без запроса доверия к workspace):

```bash
cd /srv/workspaces/project-a
agent -p --trust --output-format text \
  "Одним предложением: что делает этот репозиторий?"
```

С правками файлов в скриптах используйте осознанно `--force` / `--yolo` (см. [headless](https://cursor.com/docs/cli/headless)).

### 0.8 Сессии чатов (для параметра «чат» в RPA)

**Вы:**

```bash
# новый пустой чат, получить id
agent create-chat --workspace /srv/workspaces/project-a

# список чатов
agent ls --workspace /srv/workspaces/project-a

# продолжить чат
agent -p --trust --workspace /srv/workspaces/project-a --resume CHAT_ID \
  "Краткий ответ: сколько файлов .md в корне?"
```

Идентификатор `CHAT_ID` сохраняйте в своей БД/конфиге RPA вместе с парой «проект».

**Важно для автоматизации:** команда `agent ls` открывает **интерактивный TUI** (Ink) и в **неинтерактивном** SSH (скрипты, CI, вызов из другого сервиса) часто падает с ошибкой про *raw mode*. Полный список сессий смотрите в **обычном** интерактивном терминале. Для RPA удобнее хранить `CHAT_ID` у себя или вести журнал (см. обёртку ниже).

### 0.8.1 Обёртка [scripts/rpa-agent.sh](../scripts/rpa-agent.sh)

Готовый MVP на bash (команды `QUERY`, `APPLY`, `NEW_CHAT`, `LIST_CHATS`):

- **`NEW_CHAT`** вызывает `agent create-chat`, дописывает строку в `~/.config/cursor-rpa/chats.log` (права `600`), печатает id чата; при непустом промпте сразу делает первый `agent -p --resume`.
- **`LIST_CHATS`** выводит последние записи из `chats.log` для данного workspace (не вызывает `agent ls`).
- **`QUERY` / `APPLY`** — `agent -p` с `--resume` при непустом `CHAT_ID`.

Если файл пришел в формате CRLF, уберите переводы строк: `perl -pi -e 's/\r//g' ~/.local/bin/rpa-agent.sh`.

### 0.9 (Опционально) Desktop Cursor на Linux

Если на dev-VM установлен **графический** стол: приложение Cursor для Linux можно взять с [cursor.com](https://cursor.com/) (`.deb` / AppImage — по инструкции сайта). Для **серверного RPA** основной путь — **CLI `agent`**, GUI не обязателен.

---

## Спецификация VDS для заказа у хостинга

| Параметр | Рекомендация |
|----------|----------------|
| **ОС** | **Ubuntu Server 24.04 LTS** amd64 (или 22.04 LTS) |
| **vCPU** | минимум 2; для нескольких параллельных `agent` — 4+ |
| **RAM** | минимум 4 ГБ; комфортно 8 ГБ |
| **Диск** | SSD от 40 ГБ |
| **Сеть** | исходящий HTTPS; **SSH** |
| **Учётка Cursor** | подписка с доступом к **Agent CLI** и **API key** |

Пример целевого хоста (ваша сеть): `172.24.71.157` — должен быть доступен с машины, откуда подключаетесь (VPN/LAN).

---

## Этапы на VDS (кратко)

Повторите **этап 0** на чистой Ubuntu: пакеты → `curl … | bash` → ключ → `agent status` → каталоги `/srv/workspaces/...` → тест `-p`.

Дополнительно **Вы:**

- **Базовая гигиена:** `unattended-upgrades`, непривилегированный пользователь для RPA, `ufw` (разрешить 22/tcp при необходимости).
- **Секреты:** ключ только на сервере, права `600`, не в git.
- **Паритет с dev:** см. следующий раздел.

---

## Паритет dev-VM → VDS («1:1» по смыслу)

**Цель:** на VDS те же **версия `agent`**, **те же пути** workspaces, **те же** systemd-юниты и скрипты RPA, что и на dev.

**Вы на dev-VM** соберите и сохраните (можно вставить в чат Ассистенту):

```bash
lsb_release -a
agent --version
apt list --installed 2>/dev/null | head -n 5   # при необходимости полный список
systemctl list-units --type=service --all | grep -i rpa || true
ls -la /srv/workspaces
```

**Ассистент:** по выводу составит чеклист и команды для VDS; обновит [context-vds-cursor-rpa.md](context-vds-cursor-rpa.md).

**Вы на VDS:** выполните те же шаги установки, сверьте `agent --version` и пути.

---

## Спецификация входа RPA и соответствие CLI

Сервис RPA (ваша реализация) принимает логические поля; ниже — рекомендуемый маппинг на `agent`:

| Поле RPA | Реализация |
|----------|------------|
| **проект** | Идентификатор → абсолютный путь workspace; в CLI: `--workspace /srv/workspaces/...` |
| **чат** | `CHAT_ID` → `--resume CHAT_ID`; для нового диалога: вызвать `agent create-chat`, сохранить id |
| **промпт** | Текст запроса аргументом к `agent -p "..."` или через stdin по вашему выбору |
| **код команды** | Например `QUERY` / `APPLY` / `NEW_CHAT`; `LIST_CHATS` — вручную `agent ls` в интерактивном SSH **или** журнал через [rpa-agent.sh](../scripts/rpa-agent.sh) |

Очередь/блокировки: не запускайте два одновременных `agent` на один и тот же `CHAT_ID`/критичный workspace без сериализации.

---

## MVP обёртки

Базовая реализация: [scripts/rpa-agent.sh](../scripts/rpa-agent.sh). Дальше можно обернуть в `systemd` / HTTP и читать JSON из stdin. Минимальный контракт тела запроса:

```json
{
  "command": "QUERY",
  "project_path": "/srv/workspaces/project-a",
  "chat_id": "optional-or-null-for-new",
  "prompt": "Текст задачи"
}
```

Реализацию HTTP/gRPC оставьте за своим стеком; важно — стабильный `PATH` к `agent` и переменная `CURSOR_API_KEY` в окружении сервиса.

---

## Опционально: GUI-автоматизация

Имитация кликов по окну Cursor (X11/Xvfb, xdotool и т.д.) на сервере возможна, но **хрупкая** и тяжёлая. Для RPA на VDS рекомендуется **только CLI**.

---

Сценарий **Telegram → агент → деплой UI / APK**: [telegram-rpa-pipeline.md](telegram-rpa-pipeline.md).

## Оговорки

- CLI может меняться (beta); фиксируйте `agent --version` в [context-vds-cursor-rpa.md](context-vds-cursor-rpa.md).
- Условия использования Cursor — на стороне [cursor.com](https://cursor.com/); для продакшена сверьтесь с ToS.

---

## Что сделать после чтения (Dev)

**Вы:** выполните этап **0.2–0.8** на `ubuntu-24.04.2-server` VM, заполните [context-vds-cursor-rpa.md](context-vds-cursor-rpa.md), пришлите Ассистенту вывод `agent --version` и `agent status` при проблемах.

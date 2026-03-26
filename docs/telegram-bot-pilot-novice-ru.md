# Пилотный Telegram-бот: пошаговая инструкция для новичка

Цель: на **Linux-сервере** (например dev-rpa), где уже стоят `agent` и `rpa-agent.sh`, запустить бота, который пересылает сообщения в Cursor Agent.

---

## Что должно быть заранее

Всё ниже относится к **тому Linux-пользователю, от которого вы запустите бота** (часто **`cursorrpa`**, а не `shevbo`). Если CLI ставили только под `shevbo`, под `cursorrpa` нужно повторить установку `agent` / скопировать `~/.local/bin` и `~/.config/cursor-rpa/env.sh` (права `600` на `env.sh`).

- Доступ по **SSH** к серверу (например `ssh dev-rpa-cursorrpa` для пользователя **`cursorrpa`** — см. [accounts-cursorrpa-ru.md](accounts-cursorrpa-ru.md)).
- Установлен **Cursor Agent CLI**; в `PATH` есть **`$HOME/.local/bin`** (после установки откройте новый терминал или выполните `source ~/.bashrc`), иначе команда `agent` «не найдена».
- Работает проверка с ключом, например: `agent -p --trust --output-format text "OK"` (или как у вас уже настроено).
- Файл с ключом, например **`~/.config/cursor-rpa/env.sh`**, со строкой `export CURSOR_API_KEY="..."` — это же значение по умолчанию для бота (`CURSOR_ENV_FILE`).
- Скрипт **`rpa-agent.sh`** в **`~/.local/bin/rpa-agent.sh`**, права **`chmod +x`** — совпадает с дефолтом `RPA_AGENT_SCRIPT` в боте.

**Проверка одним блоком** (под пользователем бота, на сервере). **Не копируйте** строки `` ``` `` из этого файла — вставьте в терминал **только команды** ниже.

```bash
test -x "$HOME/.local/bin/agent" && echo "agent: OK" || echo "agent: НЕТ — установите CLI"
test -x "$HOME/.local/bin/rpa-agent.sh" && echo "rpa-agent.sh: OK" || echo "rpa-agent.sh: НЕТ"
test -f "$HOME/.config/cursor-rpa/env.sh" && echo "env.sh: есть" || echo "env.sh: НЕТ"
grep -q 'CURSOR_API_KEY' "$HOME/.config/cursor-rpa/env.sh" 2>/dev/null && echo "ключ в env: OK" || echo "ключ: проверьте env.sh"
source ~/.config/cursor-rpa/env.sh 2>/dev/null; export PATH="$HOME/.local/bin:$PATH"
agent -p --trust --output-format text "Ответь одним словом: OK"
```

Если чего-то нет — сначала пройдите [deploy-cursor-vds-rpa.md](deploy-cursor-vds-rpa.md) (этап 0).

---

## Шаг 1. Положить код на сервер

**Вариант A — Git (удобно обновлять):**

Для **SSH**-URL (`git@github.com:...`) у пользователя бота должен быть ключ и он добавлен в GitHub, иначе будет `Permission denied (publickey)`. Скрипт: [scripts/cursorrpa-github-ssh-setup.sh](../scripts/cursorrpa-github-ssh-setup.sh) — запускать **под тем же пользователем**, что будет `git clone` (часто `cursorrpa`). Альтернатива: **HTTPS** и Personal Access Token.

**Как добавить ключ в GitHub (по шагам):**

1. На сервере под нужным пользователем получите **одну строку** публичного ключа (если скрипт уже запускали — можно так):
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
   Это **одна длинная строка**: сначала `ssh-ed25519`, потом длинный набор букв/цифр, в конце комментарий (например `cursorrpa@cursorrpa`). Скопируйте **всю строку целиком**.
2. В браузере войдите в GitHub под **своим** аккаунтом (тот, у которого есть доступ к репозиторию CursorRPA).
3. Откройте: [github.com/settings/keys](https://github.com/settings/keys) (или **Settings** → слева **SSH and GPG keys**).
4. Нажмите зелёную кнопку **New SSH key**.
5. Поле **Title** — любое имя для себя, например `dev-rpa cursorrpa`.
6. Поле **Key** — **вставьте** скопированную строку из шага 1 (одна строка, без переносов посередине).
7. Нажмите **Add SSH key**, при необходимости подтвердите паролем GitHub.
8. На сервере проверка:
   ```bash
   ssh -T git@github.com
   ```
   При первом разе введите `yes` на вопрос про fingerprint. В ответе должно быть что-то вроде: `Hi <ваш_ник>! You've successfully authenticated...`

```bash
cd ~
git clone <URL_вашего_репозитория_CursorRPA> CursorRPA
cd CursorRPA/services/telegram-bridge
```

**Вариант B — копирование через `scp`:**

```powershell
scp -r "./services/telegram-bridge" dev-rpa:~/CursorRPA/services/
```

(Если у вас другой `Host` в SSH config — замените `dev-rpa` на него.)

---

## Шаг 2. Python и виртуальное окружение

На сервере:

```bash
cd ~/CursorRPA/services/telegram-bridge
sudo apt-get update
sudo apt-get install -y python3 python3-venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Дальше в инструкции считаем, что перед запуском бота вы делаете `source .venv/bin/activate`.

---

## Шаг 3. Токен бота и ваш Telegram ID

1. В Telegram откройте **@BotFather** → **/newbot** (или возьмите уже созданного бота) → скопируйте **токен**.
2. Узнайте свой **числовой ID** (например через **@userinfobot** или **@getidsbot**) — это длинное число, не никнейм.

---

## Шаг 4. Файл `.env`

Шаблон для **`cursorrpa`** на dev-rpa: [config.cursorrpa.example.env](../services/telegram-bridge/config.cursorrpa.example.env) — можно `cp config.cursorrpa.example.env .env` вместо общего `config.example.env`.

```bash
cd ~/CursorRPA/services/telegram-bridge
cp config.example.env .env
nano .env
```

Заполните минимум:

| Переменная | Пример | Зачем |
|------------|--------|--------|
| `TELEGRAM_BOT_TOKEN` | от BotFather | без него бот не запустится |
| `TELEGRAM_ALLOWED_USER_IDS` | `123456789` | только вы сможете пользоваться ботом (через запятую, если несколько человек) |
| `CURSOR_RPA_FIXED_WORKSPACE` | `/home/shevbo/workspaces/мой_проект` | один бот = один проект; каталог можно создать заранее или бот создаст при старте |
| `RPA_AGENT_SCRIPT` | `/home/shevbo/.local/bin/rpa-agent.sh` | путь к обёртке |
| `CURSOR_ENV_FILE` | `/home/shevbo/.config/cursor-rpa/env.sh` | откуда подхватить `CURSOR_API_KEY` |

Если бот запускаете под **`cursorrpa`**, те же поля, но пути к дому `cursorrpa`, например: `CURSOR_RPA_FIXED_WORKSPACE=/home/cursorrpa/workspaces/мой_проект`, `RPA_AGENT_SCRIPT=/home/cursorrpa/.local/bin/rpa-agent.sh`, `CURSOR_ENV_FILE=/home/cursorrpa/.config/cursor-rpa/env.sh`. Скопировать CLI и `env.sh` с `shevbo` можно скриптом [scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh](../scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh).

Сохраните файл. Права:

```bash
chmod 600 .env
```

**Важно:** не выкладывайте `.env` в git (в репозитории он в `.gitignore`).

---

## Шаг 5. Создать каталог проекта (если ещё нет)

```bash
mkdir -p /home/shevbo/workspaces/мой_проект
```

(Под **`cursorrpa`:** `mkdir -p /home/cursorrpa/workspaces/мой_проект` и тот же путь в `CURSOR_RPA_FIXED_WORKSPACE`.)

Имя должно совпадать с путём в `CURSOR_RPA_FIXED_WORKSPACE`.

---

## Шаг 6. Первый запуск вручную (проверка)

```bash
cd ~/CursorRPA/services/telegram-bridge
source .venv/bin/activate
set -a && source .env && set +a
python bot.py
```

Оставьте терминал открытым. В Telegram найдите своего бота и проверьте цепочку:

1. **`/ping`** — должен ответить `pong` и показать путь workspace.
2. **`/newchat`** — создаст чат Cursor и пришлёт **UUID** (длинная строка с дефисами).
3. Отправьте короткий текст, например: **`Ответь одним словом: OK`**
4. **`/status`** — тот же workspace, тот же chat id, очередь «свободна».

Если что-то падает — скопируйте текст ошибки из терминала (без токена и ключа).

Остановка теста: в терминале **Ctrl+C**.

---

## Шаг 7. Запуск через systemd (чтобы бот работал всегда)

1. Скопируйте пример юнита и поправьте пути и пользователя. Для **`shevbo`:** `cursor-telegram-bridge.service.example`. Для **`cursorrpa`:** готовый шаблон [cursor-telegram-bridge.service.cursorrpa.example](../services/telegram-bridge/systemd/cursor-telegram-bridge.service.cursorrpa.example) (при другом расположении репозитория замените пути в `WorkingDirectory`, `EnvironmentFile`, `ExecStart`).

```bash
sudo cp ~/CursorRPA/services/telegram-bridge/systemd/cursor-telegram-bridge.service.example \
  /etc/systemd/system/cursor-telegram-bridge.service
sudo nano /etc/systemd/system/cursor-telegram-bridge.service
```

Проверьте строки **`User=`**, **`WorkingDirectory=`**, **`ExecStart=`**, **`EnvironmentFile=`** — они должны указывать на **ваши** пути к `telegram-bridge` и `.env`.

2. Включите сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cursor-telegram-bridge
sudo systemctl status cursor-telegram-bridge
```

3. Логи при проблемах:

```bash
journalctl -u cursor-telegram-bridge -f --no-pager
```

---

## Шаг 8. Обновление кода после правок

На сервере:

```bash
cd ~/CursorRPA
git pull
# или снова scp из вашего текущего окружения
```

Затем перезапуск:

```bash
sudo systemctl restart cursor-telegram-bridge
```

или, если запускали вручную — остановить Ctrl+C и снова `python bot.py`.

---

## Что проверить, если «не работает»

| Симптом | Что смотреть |
|---------|----------------|
| Бот молчит | Токен в `.env`, интернет с сервера, `journalctl` |
| «Доступ запрещён» | Ваш Telegram ID в `TELEGRAM_ALLOWED_USER_IDS` без пробелов |
| Ошибка про `rpa-agent.sh` | Путь в `RPA_AGENT_SCRIPT`, `chmod +x`, нет ли `\r` в файле (CRLF) |
| Ошибка агента / таймаут | `CURSOR_API_KEY`, `AGENT_TIMEOUT_SEC`, логи в консоли |
| Workspace не найден | Путь в `CURSOR_RPA_FIXED_WORKSPACE`, `mkdir -p` |
| `Authentication required` / ключ | Файл `env.sh` существует, в нём `export CURSOR_API_KEY=...`, перед запуском бота: `source` этого файла или верный `CURSOR_ENV_FILE` в `.env` |
| `env.sh: No such file` | Создайте `~/.config/cursor-rpa/env.sh` вручную или под `shevbo`: [sync-cursor-tools-shevbo-to-cursorrpa.sh](../scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh) / только ключ: [cursorrpa-sync-env-from-shevbo.sh](../scripts/cursorrpa-sync-env-from-shevbo.sh). Если в каталоге есть **`.env.sh.swp`** без `env.sh` — не сохранили файл в vim; скрипт sync удалит `*.swp` и скопирует `env.sh` заново |
| `unexpected EOF` в `.bashrc` | Незакрытая кавычка в `~/.bashrc`; проверка: `bash -n ~/.bashrc`, правка около указанной строки |

---

## Следующий этап (когда пилот стабилен)

- Переключение **модулей** и разных чатов Cursor: команды вида `/module` (пока не в пилоте).
- **`/dirrep`** — просмотр файлов репозитория кнопками (отдельная доработка).

Подробнее про общую схему: [telegram-rpa-pipeline.md](telegram-rpa-pipeline.md).

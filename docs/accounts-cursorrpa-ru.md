# Учётная запись Linux `cursorrpa` для проекта CursorRPA

Отдельный пользователь без лишних прав: бот, workspace, деплой — под ним; администрирование — под `ubuntu` / `shevbo` с `sudo`.

---

## hoster (`83.69.248.175`) — создано

- Пользователь **`cursorrpa`** (uid 1001), домашний каталог `/home/cursorrpa`.
- Каталог **`/home/cursorrpa/workspaces`** для репозиториев/артефактов.
- В **`~/.ssh/authorized_keys`** скопирован тот же ключ, что у **`ubuntu`** (вход тем же `id_ed25519`).

**SSH (в `~/.ssh/config` уже есть алиас `hoster-cursorrpa`):**

```bash
ssh hoster-cursorrpa
```

Проверка:

```bash
whoami   # cursorrpa
ls -la ~/workspaces
```

**Замечание:** пользователь **без** группы `sudo`. Установка пакетов — под `ubuntu`: `ssh hoster`, затем `sudo apt …`.

---

## dev-rpa (`172.24.71.157`) — скрипт или копипаст

**Пошагово и безпарольный sudo для shevbo:** [dev-rpa-copy-paste-ru.md](dev-rpa-copy-paste-ru.md)  
Скрипт в репозитории: [scripts/dev-rpa-setup-cursorrpa-and-sudo.sh](../scripts/dev-rpa-setup-cursorrpa-and-sudo.sh)

**Passwordless sudo для `cursorrpa`** (чтобы не вводить пароль при каждом `sudo`): на dev-rpa под `shevbo` (или другим пользователем с `sudo`), один раз после копирования скрипта на сервер:

```bash
bash dev-rpa-setup-cursorrpa-and-sudo.sh --nopasswd-cursorrpa
```

Создаётся `/etc/sudoers.d/99-cursorrpa-nopasswd` (`cursorrpa ALL=(ALL) NOPASSWD: ALL`). Риск: компрометация аккаунта `cursorrpa` = полный root без пароля — только на своей dev-VM.

Кратко вручную (под `ssh dev-rpa`):

```bash
sudo useradd -m -s /bin/bash cursorrpa
sudo mkdir -p /home/cursorrpa/workspaces /home/cursorrpa/.ssh
sudo chmod 700 /home/cursorrpa/.ssh
sudo cp /home/shevbo/.ssh/authorized_keys /home/cursorrpa/.ssh/authorized_keys
sudo chmod 600 /home/cursorrpa/.ssh/authorized_keys
sudo chown -R cursorrpa:cursorrpa /home/cursorrpa
```

Проверка доступа:

```bash
ssh dev-rpa-cursorrpa
whoami
```

Если вход по ключу не сработал — на dev-rpa под `shevbo` проверьте содержимое `/home/cursorrpa/.ssh/authorized_keys`.

---

## Дальше под `cursorrpa`

- Клонировать репозиторий в `~/workspaces/CursorRPA` или задать `CURSOR_RPA_FIXED_WORKSPACE` на этот путь.
- Файл **`~/.config/cursor-rpa/env.sh`** с `CURSOR_API_KEY` создаётся **вручную** (права `600`), ключ в чат не копировать.
- Установка **Cursor CLI** под `cursorrpa`: тот же скрипт `curl https://cursor.com/install | bash`, затем `~/.local/bin` в `~/.bashrc`.
- **Быстрее с dev-rpa:** если под `shevbo` уже есть рабочие `~/.local/bin` и `env.sh`, на сервере под `shevbo` выполните [scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh](../scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh) — копия в `/home/cursorrpa` с `chown cursorrpa`, удаление зависших `*.swp`, проверка `agent -p` от имени `cursorrpa`.
- Только **`env.sh`** (если CLI уже у `cursorrpa`, а ключ потерян или остался только `.env.sh.swp` от vim): [scripts/cursorrpa-sync-env-from-shevbo.sh](../scripts/cursorrpa-sync-env-from-shevbo.sh).

**Важно:** каталог `/home/cursorrpa` для **других** пользователей закрыт (`750`). Команды **`ls` под `shevbo` без `sudo`** внутри `/home/cursorrpa/...` дадут *Permission denied* — это нормально; проверяйте `sudo ls` или зайдите SSH под **`cursorrpa`**.

**Почему нельзя только скопировать `~/.local/bin`:** бинарники Cursor Agent часто — **симлинки** на `~/.local/share/cursor-agent/...`. Если скопировать только `bin`, ссылки остаются на **`/home/shevbo/...`**, и у `cursorrpa` **agent не запускается**. Скрипт [sync-cursor-tools-shevbo-to-cursorrpa.sh](../scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh) копирует и **`share/cursor-agent`**, и перепривязывает ссылки.

**GitHub по SSH под `cursorrpa`:** отдельная пара ключей или скрипт [cursorrpa-github-ssh-setup.sh](../scripts/cursorrpa-github-ssh-setup.sh); публичный ключ — в настройках GitHub. Без этого `git clone git@github.com:...` даст `Permission denied (publickey)`.

### Подключение `env.sh` в `~/.bashrc`

Предпочтительно одна строка (ключ не светится в исторории, если редактируете файл напрямую):

```bash
echo "source ~/.config/cursor-rpa/env.sh" >> ~/.bashrc
```

После правок проверьте синтаксис: `bash -n ~/.bashrc`. Ошибка `unexpected EOF while looking for matching` чаще всего из‑за **незакрытой кавычки** в `.bashrc` (обрезанный `export` или `echo '...'`).

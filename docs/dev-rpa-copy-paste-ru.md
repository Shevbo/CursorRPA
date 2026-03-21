# dev-rpa: один раз вставить в терминал

Выполняйте **на машине dev-rpa**, сессия SSH под **`shevbo`**. Пароль `sudo` введёте при запросе (несколько раз, если без NOPASSWD).

---

## Вариант A — только файл на сервере (удобно)

С ПК скопируйте скрипт на dev-rpa:

```powershell
scp "C:\Users\Boris\CursorRPA\scripts\dev-rpa-setup-cursorrpa-and-sudo.sh" dev-rpa:~/
```

На сервере (если копировали с Windows — уберите **CRLF**, иначе ошибка `$'\r': command not found`):

```bash
sed -i 's/\r$//' ~/dev-rpa-setup-cursorrpa-and-sudo.sh
chmod +x ~/dev-rpa-setup-cursorrpa-and-sudo.sh
bash ~/dev-rpa-setup-cursorrpa-and-sudo.sh
```

---

## Вариант B — один блок копипаста (без scp)

Вставьте **целиком** в bash на dev-rpa:

```bash
bash -s <<'ENDOFSCRIPT'
set -euo pipefail
echo "=== Пользователь cursorrpa ==="
if id cursorrpa &>/dev/null; then echo "Уже есть: cursorrpa"; else sudo useradd -m -s /bin/bash cursorrpa; echo "Создан: cursorrpa"; fi
sudo mkdir -p /home/cursorrpa/workspaces /home/cursorrpa/.ssh
sudo chmod 700 /home/cursorrpa/.ssh
if [[ -f /home/shevbo/.ssh/authorized_keys ]]; then
  sudo cp /home/shevbo/.ssh/authorized_keys /home/cursorrpa/.ssh/authorized_keys
  sudo chmod 600 /home/cursorrpa/.ssh/authorized_keys
  echo "SSH: authorized_keys скопирован"
else echo "ВНИМАНИЕ: нет /home/shevbo/.ssh/authorized_keys"; fi
sudo chown -R cursorrpa:cursorrpa /home/cursorrpa
echo "Готово. С ПК: ssh dev-rpa-cursorrpa"
ENDOFSCRIPT
```

---

## Как сделать passwordless sudo для shevbo

**Смысл:** в файле `/etc/sudoers.d/` правило `NOPASSWD: ALL` для `shevbo`, чтобы `sudo` не спрашивал пароль (удобно для скриптов и агента).

**Риск:** любой, кто получит доступ к аккаунту `shevbo`, сможет выполнить любую команду от root.

### Способ 1 — вместе со скриптом (после копирования файла)

```bash
bash ~/dev-rpa-setup-cursorrpa-and-sudo.sh --nopasswd-sudo
```

Один раз введёте пароль `sudo`; затем создаётся `/etc/sudoers.d/99-shevbo-nopasswd`.

### Способ 2 — только копипаст (если scp не использовали)

```bash
echo 'shevbo ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/99-shevbo-nopasswd >/dev/null
sudo chmod 440 /etc/sudoers.d/99-shevbo-nopasswd
sudo visudo -c -f /etc/sudoers.d/99-shevbo-nopasswd
sudo -n true && echo "NOPASSWD_OK"
```

Последняя строка в **том же** сеансе может всё ещё запросить пароль — откройте **новый** `ssh dev-rpa` и снова `sudo -n true`.

### Откат

```bash
sudo rm -f /etc/sudoers.d/99-shevbo-nopasswd
sudo visudo -c
```

### Узкий вариант (без полного NOPASSWD)

Вместо `ALL` можно перечислить только нужные бины (сложнее поддерживать). Для одной dev-VM часто достаточно полного NOPASSWD осознанно.

---

## После создания `cursorrpa`: Cursor CLI и `env.sh`

Если под `shevbo` уже установлен `agent` и есть `~/.config/cursor-rpa/env.sh`, скопируйте в домашний каталог `cursorrpa` одним скриптом (на dev-rpa под **`shevbo`**):

```powershell
scp "C:\Users\Boris\CursorRPA\scripts\sync-cursor-tools-shevbo-to-cursorrpa.sh" dev-rpa:~/
```

```bash
sed -i 's/\r$//' ~/sync-cursor-tools-shevbo-to-cursorrpa.sh
chmod +x ~/sync-cursor-tools-shevbo-to-cursorrpa.sh
~/sync-cursor-tools-shevbo-to-cursorrpa.sh
```

Подробнее: [scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh](../scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh).

---

## Только `env.sh` (без повторного копирования всего `~/.local/bin`)

Если у `cursorrpa` уже есть `agent`, а **`env.sh` отсутствует** или в каталоге остался только **`.env.sh.swp`** (vim не сохранил файл):

```powershell
scp "C:\Users\Boris\CursorRPA\scripts\cursorrpa-sync-env-from-shevbo.sh" dev-rpa:~/
```

```bash
sed -i 's/\r$//' ~/cursorrpa-sync-env-from-shevbo.sh
chmod +x ~/cursorrpa-sync-env-from-shevbo.sh
~/cursorrpa-sync-env-from-shevbo.sh
```

---

См. также [accounts-cursorrpa-ru.md](accounts-cursorrpa-ru.md).

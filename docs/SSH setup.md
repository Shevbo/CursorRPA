# SSH setup (Ubuntu / Windows)

Короткая инструкция, как настроить SSH **по ключу** (без пароля) для доступа к серверу/устройству (например `shevbo-pi`) и удобно завести алиас в `~/.ssh/config`.

## Ubuntu (Linux)

### 1) Сгенерировать ключ

```bash
ssh-keygen -t ed25519 -f ~/.ssh/<key_name> -C "<comment>"
```

- На запрос passphrase просто нажмите **Enter** два раза (пустой пароль), если хотите вход без ввода пароля/пин-кода.

Пример:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/shevbo_pi_lan_ed25519 -C "pc->shevbo-pi(lan)"
```

### 2) Добавить публичный ключ на удалённый хост (1 раз введёте пароль удалённого пользователя)

Если есть `ssh-copy-id`:

```bash
ssh-copy-id -i ~/.ssh/<key_name>.pub <user>@<host_or_ip>
```

Если `ssh-copy-id` нет:

```bash
cat ~/.ssh/<key_name>.pub | ssh <user>@<host_or_ip> 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

### 3) Добавить алиас в `~/.ssh/config`

```ssh-config
Host <alias>
  HostName <host_or_ip>
  User <user>
  IdentityFile ~/.ssh/<key_name>
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
```

Пример для Pi в локальной сети:

```ssh-config
Host shevbo-pi
  HostName 192.168.1.50
  User shevbo
  IdentityFile ~/.ssh/shevbo_pi_lan_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
```

### 4) Проверка (без пароля)

```bash
ssh -o BatchMode=yes <alias> 'echo OK'
```

## Windows (PowerShell / Windows Terminal)

В Windows OpenSSH обычно уже есть. Путь к ключам: `C:\Users\<You>\.ssh\`.

### 1) Сгенерировать ключ

Вариант A (проще): без `-N`, на вопрос passphrase просто **Enter** два раза:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\<key_name>" -C "<comment>"
```

Пример:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\shevbo_pi_lan_ed25519" -C "pc->shevbo-pi(lan)"
```

Вариант B: явно пустой пароль через `cmd` (если нужно именно `-N ""`):

```powershell
cmd /c ssh-keygen -t ed25519 -f "%USERPROFILE%\.ssh\<key_name>" -C "<comment>" -N ""
```

### 2) Добавить публичный ключ на удалённый хост

Обычно `ssh-copy-id` в Windows отсутствует — используйте пайп:

```powershell
type $env:USERPROFILE\.ssh\<key_name>.pub | ssh <user>@<host_or_ip> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### 3) Добавить алиас в `%USERPROFILE%\.ssh\config`

Файл: `C:\Users\<You>\.ssh\config`

Добавьте:

```ssh-config
Host <alias>
  HostName <host_or_ip>
  User <user>
  IdentityFile ~/.ssh/<key_name>
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
```

Пример:

```ssh-config
Host shevbo-pi
  HostName 192.168.1.50
  User shevbo
  IdentityFile ~/.ssh/shevbo_pi_lan_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
```

### 4) Проверка

```powershell
ssh -o BatchMode=yes shevbo-pi "echo OK"
```

## Частые ошибки

- **`ssh-keygen: option requires an argument -- N` (Windows/PowerShell)**: PowerShell может некорректно передать пустой `-N ""`. Используйте вариант без `-N` (Enter/Enter) или `cmd /c ... -N ""`.
- **`Host key verification failed`**: удалите старый ключ хоста и подключитесь заново: `ssh-keygen -R <host_or_ip>`.
- **`Permission denied (publickey,password)`**: ключ не добавлен в `~/.ssh/authorized_keys` на удалённом хосте или неверно выбран `IdentityFile`/`User`.


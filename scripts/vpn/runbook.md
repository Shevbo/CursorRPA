# VPN Runbook: WireGuard + autossh fallback (VDS ↔ Pi)

## Архитектура

```
Pi ──[WireGuard UDP 51820]──► VDS (10.66.0.1)
Pi ──[autossh TCP 443]──────► VDS (reverse tunnel)

VDS nginx:4444 → upstream { 10.66.0.2:4444 (WG primary), 127.0.0.1:24444 (fallback) }
VDS nginx:4555 → upstream { 10.66.0.2:4555 (WG primary), 127.0.0.1:24555 (fallback) }
```

## Шаг 1: WireGuard на VDS

```bash
# На VDS (root):
cd /home/shectory/workspaces/CursorRPA/scripts/vpn
sudo bash wg-server-setup.sh
# Запомни напечатанный Server public key
```

Скрипт:
- Устанавливает `wireguard-tools`
- Генерирует ключи сервера
- Создаёт `/etc/wireguard/wg0.conf` (Address=10.66.0.1/24, ListenPort=51820)
- Включает IP forwarding
- Открывает UDP 51820 в ufw/iptables
- Запускает `wg-quick@wg0`

## Шаг 2: WireGuard на Pi

```bash
# На Pi (root):
# Скопируй скрипт на Pi:
scp scripts/vpn/wg-pi-client-setup.sh pi@<PI_IP>:~/

# На Pi:
sudo bash wg-pi-client-setup.sh \
  --vds-pubkey <VDS_SERVER_PUBKEY_FROM_STEP_1> \
  --vds-endpoint shectory.ru:51820
# Запомни напечатанный Pi public key
```

## Шаг 3: Добавить Pi peer на VDS

```bash
# На VDS (root):
sudo bash wg-vds-add-pi-peer.sh --pi-pubkey <PI_PUBKEY_FROM_STEP_2>
```

## Шаг 4: Проверить WireGuard туннель

```bash
# На VDS:
wg show
ping -c3 10.66.0.2

# На Pi:
ping -c3 10.66.0.1
```

## Шаг 5: autossh fallback на Pi

### 5.1 Создать SSH ключ для туннеля

```bash
# На Pi:
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_tunnel -N ""
cat ~/.ssh/id_ed25519_tunnel.pub
```

### 5.2 Добавить публичный ключ на VDS

```bash
# На VDS:
echo "<TUNNEL_PUBLIC_KEY>" >> /home/shectory/.ssh/authorized_keys
```

### 5.3 Убедиться, что SSH слушает на порту 443

```bash
# На VDS (в /etc/ssh/sshd_config добавить или изменить):
Port 22
Port 443
# Затем: systemctl restart sshd
```

### 5.4 Установить autossh и настроить env

```bash
# На Pi:
sudo apt-get install -y autossh
sudo mkdir -p /etc/shectory
sudo cp autossh-tunnel.env.example /etc/shectory/autossh-tunnel.env
sudo nano /etc/shectory/autossh-tunnel.env
# Заполни TUNNEL_HOST, TUNNEL_USER, TUNNEL_SSH_KEY и т.д.
sudo chmod 600 /etc/shectory/autossh-tunnel.env
```

### 5.5 Установить systemd service

```bash
# На Pi:
sudo cp autossh-pi-reverse-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now autossh-pi-reverse-tunnel.service
sudo systemctl status autossh-pi-reverse-tunnel.service
```

### 5.6 Проверить fallback порты на VDS

```bash
# На VDS:
ss -tlnp | grep -E '24444|24555|22022'
curl -s --max-time 3 http://127.0.0.1:24444/ && echo "syslog fallback OK"
curl -s --max-time 3 http://127.0.0.1:24555/ && echo "pingmaster fallback OK"
```

## Шаг 6: Переключить nginx на WireGuard upstream

```bash
# На VDS (root):
cd /home/shectory/workspaces/CursorRPA/scripts/vpn
sudo bash deploy-nginx-pi-proxy.sh
```

Скрипт:
- Удаляет старый `syslog-pi-4444.conf` (бэкап в `.bak`)
- Устанавливает `nginx-pi-4444-4555.conf` с upstream WG + fallback
- Добавляет `:4555` (PingMaster) — его раньше не было
- Тестирует и перезагружает nginx

## Шаг 7: Мониторинг WireGuard

```bash
# На VDS (root):
cp wg-monitor.sh /usr/local/bin/wg-monitor.sh
chmod +x /usr/local/bin/wg-monitor.sh
cp wg-monitor.service wg-monitor.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wg-monitor.timer
# Проверить:
systemctl list-timers wg-monitor.timer
journalctl -u wg-monitor.service -n 20
```

Монитор запускается каждую минуту и отправляет Telegram-алерт при смене статуса:
- `ok` → WireGuard работает, оба порта доступны
- `fallback` → WG деградировал, работает autossh
- `down` → нет связи ни через WG, ни через fallback

## Откат (если что-то пошло не так)

```bash
# Восстановить старый nginx конфиг:
sudo mv /etc/nginx/conf.d/syslog-pi-4444.conf.bak /etc/nginx/conf.d/syslog-pi-4444.conf
sudo rm -f /etc/nginx/conf.d/pi-services.conf
sudo nginx -t && sudo systemctl reload nginx

# Остановить WireGuard:
sudo systemctl stop wg-quick@wg0
sudo systemctl disable wg-quick@wg0
```

## apt update: ошибка Tailscale / trixie (403, «no longer signed»)

На Debian **trixie** (testing) или если в `/etc/apt/sources.list.d/` висит **pkgs.tailscale.com** для кодового имени, которого ещё нет в репозитории Tailscale, `apt-get update` падает. Для WireGuard Tailscale **не нужен**.

- Скрипты **`pi-setup-all.sh`** и **`wg-pi-client-setup.sh`** сами переименовывают `tailscale*.list` в `*.disabled` перед `apt update`.
- Вручную: `sudo mv /etc/apt/sources.list.d/tailscale*.list /tmp/` (или `.disabled`), затем `sudo apt-get update`.

## Полезные команды

```bash
# Статус WireGuard
wg show

# Последний handshake
wg show wg0 latest-handshakes

# Логи монитора
journalctl -u wg-monitor.service -f

# Логи autossh на Pi
journalctl -u autossh-pi-reverse-tunnel.service -f

# Тест портов
curl -v --max-time 5 http://shectory.ru:4444/
curl -v --max-time 5 http://shectory.ru:4555/
```

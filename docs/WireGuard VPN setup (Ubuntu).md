# WireGuard VPN setup (Ubuntu)

Короткий гайд по настройке WireGuard (WG) **между хостами на Ubuntu**: что это такое, как работает, и как поднять VPN «хаб‑и‑спицы» (один публичный сервер + клиенты).

## Вводная: как WireGuard работает

- **WireGuard = VPN на UDP**. На каждом узле есть **пара ключей** (private/public).
- Каждый узел хранит список **peers**: публичный ключ соседа + его **`AllowedIPs`**.
- **`AllowedIPs` — это одновременно:**
  - «какие IP/подсети принадлежат этому peer» (аналог маршрута),
  - и фильтр: какие пакеты WG примет/передаст через этого peer.
- **Endpoint нужен только там, где peer за NAT/динамикой.**
  - Клиент обычно знает `Endpoint = <public-ip>:51820` сервера.
  - Сервер может не знать endpoint клиента заранее — он обновится после первого пакета клиента.
- **Handshake не постоянный.** Если трафика нет, «соединение» молчит. Чтобы NAT не «забывал» клиента, ставят `PersistentKeepalive = 25`.

## Термины

- **Hub (сервер)**: публичный хост с UDP‑портом (часто `51820`), к нему подключаются клиенты.
- **Client (peer)**: хост, который поднимает интерфейс WG и ходит в приватную сеть.
- **WG интерфейс**: обычно `wg0`.
- **VPN подсеть**: например `10.66.0.0/24`.

## Шаблонная схема «hub → clients»

Пример:
- Hub: `10.66.0.1/24` (публичный IP: `HUB_PUBLIC_IP`)
- Client A: `10.66.0.2/32`
- Client B: `10.66.0.3/32`

## 1) Установка пакетов

На **каждом** хосте:

```bash
sudo apt-get update -y
sudo apt-get install -y wireguard
```

## 2) Генерация ключей

На **каждом** хосте:

```bash
sudo mkdir -p /etc/wireguard
sudo sh -c 'umask 077; wg genkey | tee /etc/wireguard/wg.key | wg pubkey > /etc/wireguard/wg.pub'
sudo cat /etc/wireguard/wg.pub
```

Скопируйте `wg.pub` каждого узла — он нужен другим.

## 3) Настройка Hub (сервер) — `/etc/wireguard/wg0.conf`

На hub:

```ini
[Interface]
Address = 10.66.0.1/24
ListenPort = 51820
PrivateKey = <HUB_PRIVATE_KEY>

# Включить маршрутизацию (если hub будет роутить между peers/подсетями)
PostUp   = sysctl -w net.ipv4.ip_forward=1
PostDown = sysctl -w net.ipv4.ip_forward=0

# Peer: Client A
[Peer]
PublicKey = <CLIENT_A_PUBLIC_KEY>
AllowedIPs = 10.66.0.2/32

# Peer: Client B
[Peer]
PublicKey = <CLIENT_B_PUBLIC_KEY>
AllowedIPs = 10.66.0.3/32
```

Важно:
- `AllowedIPs` на hub **не должны пересекаться** между peers.
- Если вы хотите, чтобы client ходил не только в VPN‑подсеть, а ещё «за hub» в другие сети — потребуется маршрутизация/iptables (в этом гайде не разворачиваем full‑tunnel).

## 4) Настройка Client — `/etc/wireguard/wg0.conf`

На client A:

```ini
[Interface]
Address = 10.66.0.2/32
PrivateKey = <CLIENT_A_PRIVATE_KEY>

[Peer]
PublicKey = <HUB_PUBLIC_KEY>
Endpoint = HUB_PUBLIC_IP:51820
AllowedIPs = 10.66.0.0/24
PersistentKeepalive = 25
```

Пояснение:
- `AllowedIPs = 10.66.0.0/24` означает: «всю подсеть 10.66.0.x отправлять через WG на hub».

## 5) Запуск

На каждом хосте:

```bash
sudo systemctl enable --now wg-quick@wg0
sudo wg show wg0
```

## 6) Проверка

С client A:

```bash
ping -c 2 10.66.0.1
ping -c 2 10.66.0.3
```

На hub:

```bash
sudo wg show wg0
```

Должен появиться `latest handshake` от клиента.

## 7) Частые проблемы

- **UDP порт закрыт**: на hub проверьте, что слушает `51820/udp`:

```bash
sudo ss -lunp | grep 51820
```

- **NAT забывает клиента**: добавьте `PersistentKeepalive = 25` на клиенте.
- **Неверный private key**: ошибка вида `Key is not the correct length or format` — ключ должен быть **base64** без кавычек/лишних символов.
- **AllowedIPs пересекаются** на hub: рукопожатие может быть, но маршрутизация «плывёт».
- **Нужен доступ к сети за hub**: потребуется включить форвардинг + NAT/маршруты (это отдельная тема).

## Пример Shectory (из практики)

Используемая подсеть: `10.66.0.0/24`

- Hub (`shectory-work`): `10.66.0.1` (слушает `51820/udp`)
- `shevbo-pi`: `10.66.0.2`
- `shevbo-cloud`: `10.66.0.3`

Паттерн тот же:
- hub содержит peers `10.66.0.2/32` и `10.66.0.3/32`,
- каждый клиент содержит peer hub с `AllowedIPs = 10.66.0.0/24` и `PersistentKeepalive = 25`.


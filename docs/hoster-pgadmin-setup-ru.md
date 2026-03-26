# pgAdmin на Hoster (песочница)

Сервер: **`83.69.248.175`**. Установку пакетов и Docker выполняйте под пользователем с **`sudo`** (обычно **`ubuntu`**) — см. [accounts-cursorrpa-ru.md](accounts-cursorrpa-ru.md).

---

## Вариант 1: Docker (быстро для песочницы)

Подходит, если на Hoster уже есть Docker (или можно поставить `sudo apt install docker.io` и `sudo usermod -aG docker ubuntu`).

### 1) Запуск контейнера

На Hoster:

```bash
sudo docker run -d --name pgadmin \
  --restart unless-stopped \
  -p 5050:80 \
  -e PGADMIN_DEFAULT_EMAIL=bshevelev@mail.ru \
  -e PGADMIN_DEFAULT_PASSWORD='СМЕНИТЕ_ПАРОЛЬ' \
  dpage/pgadmin4
```

Веб-интерфейс: **`http://83.69.248.175:5050`** (или по домену, если настроите прокси).

### 2) Подключение pgAdmin к PostgreSQL на той же машине

В контейнере `localhost` — это **не** хост Postgres. Укажите:

- **Host name/address:** `172.17.0.1` (часто шлюз Docker → хост Linux), **или** IP сервера **`172.17.0.1` не сработал** — тогда **`83.69.248.175`** или реальный **внутренний** IP интерфейса (см. ниже).
- **Port:** `5432`
- **Username / Password:** как у роли в Postgres (например `komissionka`).

Если не коннектится, на Hoster выполните:

```bash
ip -4 addr show docker0 | grep inet
# возьмите IP docker0 — часто 172.17.0.1; в pgAdmin как Host попробуйте этот адрес
```

Либо запустите контейнер с доступом к сети хоста (проще для песочницы):

```bash
sudo docker rm -f pgadmin 2>/dev/null
sudo docker run -d --name pgadmin \
  --restart unless-stopped \
  --network host \
  -e PGADMIN_LISTEN_PORT=5050 \
  -e PGADMIN_DEFAULT_EMAIL=bshevelev@mail.ru \
  -e PGADMIN_DEFAULT_PASSWORD='СМЕНИТЕ_ПАРОЛЬ' \
  dpage/pgadmin4
```

Тогда интерфейс: **`http://83.69.248.175:5050`**, а в настройках сервера БД укажите **Host: `127.0.0.1`**, **Port: 5432**.

### 3) Файрвол

Если включён `ufw`:

```bash
sudo ufw allow 5050/tcp comment 'pgAdmin sandbox'
sudo ufw reload
sudo ufw status
```

---

## Вариант 2: pgAdmin 4 Web из пакетов (без Docker)

Официальный репозиторий PostgreSQL:

```bash
sudo apt-get install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
curl -o /tmp/pgdg.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo cp /tmp/pgdg.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update
sudo apt-get install -y pgadmin4-web
sudo /usr/pgadmin4/bin/setup-web.sh
```

Скрипт спросит e-mail и пароль для входа в веб-интерфейс и настроит **Apache**. Дальше откройте URL, который выведет установщик (часто **`http://сервер/pgadmin4`**).

Подключение к БД: **Host `localhost`**, порт **5432**.

---

## Безопасность (песочница → прод)

- Смените пароль pgAdmin после первого входа.
- Не оставляйте **5050** открытым для всего интернета без необходимости: лучше **SSH-туннель** с ноутбука:
  ```bash
  ssh -L 5050:127.0.0.1:5050 ubuntu@83.69.248.175
  ```
  затем в браузере `http://127.0.0.1:5050`.
- Для прод: **HTTPS** (nginx/Caddy + Let’s Encrypt) и ограничение по IP или VPN.

---

## Проверка Postgres до pgAdmin

На Hoster:

```bash
sudo -u postgres psql -c "SELECT version();"
```

Под пользователем приложения (если разрешено `pg_hba.conf`):

```bash
PGPASSWORD='***' psql -h 127.0.0.1 -U komissionka -d postgres -c "SELECT 1;"
```

Если с другой машины не пускает — правьте **`pg_hba.conf`** и перезагружайте Postgres (это отдельно от pgAdmin).

---

## Скрипт-обёртка (Docker + host network)

Файл в репозитории: [scripts/hoster-pgadmin-docker.sh](../scripts/hoster-pgadmin-docker.sh).

**Не используйте буквальный путь `/path/to/`** — это был шаблон. Реальный путь, например:

- если клонировали репозиторий в домашний каталог Ubuntu:
  ```bash
  cd ~
  git clone https://github.com/Shevbo/CursorRPA.git   # или ваш URL
  export PGADMIN_PASSWORD='ваш-пароль-песочницы'
  sudo -E bash ~/CursorRPA/scripts/hoster-pgadmin-docker.sh
  ```
- если репозиторий уже лежит у `cursorrpa`:
  ```bash
  export PGADMIN_PASSWORD='ваш-пароль-песочницы'
  sudo -E bash /home/cursorrpa/workspaces/CursorRPA/scripts/hoster-pgadmin-docker.sh
  ```

Узнать, где лежит скрипт: `find ~ -name hoster-pgadmin-docker.sh 2>/dev/null`

**Если вывод пустой** — файла на сервере нет. Варианты:

1. **Клонировать репозиторий** (см. блок выше с `git clone`).
2. **Скачать только скрипт** (ветка `main` на GitHub):
   ```bash
   curl -fsSL -o /tmp/hoster-pgadmin-docker.sh \
     https://raw.githubusercontent.com/Shevbo/CursorRPA/main/scripts/hoster-pgadmin-docker.sh
   chmod +x /tmp/hoster-pgadmin-docker.sh
   export PGADMIN_PASSWORD='ваш-пароль-песочницы'
   sudo -E bash /tmp/hoster-pgadmin-docker.sh
   ```
3. **Обойтись без скрипта** — блок с `docker run` ниже.

**Без клона репозитория** — одной командой Docker (эквивалент скрипта):

```bash
export PGADMIN_PASSWORD='ваш-пароль-песочницы'
sudo docker rm -f pgadmin 2>/dev/null
sudo docker run -d --name pgadmin --restart unless-stopped --network host \
  -e PGADMIN_LISTEN_PORT=5050 \
  -e PGADMIN_DEFAULT_EMAIL=bshevelev@mail.ru \
  -e PGADMIN_DEFAULT_PASSWORD="$PGADMIN_PASSWORD" \
  dpage/pgadmin4
```

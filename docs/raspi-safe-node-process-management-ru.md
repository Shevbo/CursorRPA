# Безопасная остановка Node-процессов на общем хосте (Raspberry Pi, dev-rpa)

## Зачем этот документ

На одной машине могут одновременно работать **`syslog-srv`** (`node dist/server.js` + UDP), **PingMaster**, **Next.js dev** и другие проекты в `~/workspaces/`.

Команды вида **`pkill -f "node dist/server.js"`** или **`pgrep -f "node dist/server"`** **небезопасны**: они убивают **все** процессы, у которых в командной строке есть эта подстрока, включая **чужие сервисы** (реальный инцидент: остановка `syslog-srv` на Raspberry Pi при очистке PingMaster).

## Требование (обязательно для агентов и ручных runbook)

1. **Запрещено** на общих хостах с несколькими Node-проектами:
   - `pkill -f 'node dist/server.js'`
   - `pkill -f 'npm start'` без привязки к каталогу
   - любые **`pkill -f`** / **`kill $(pgrep -f …)`** по общим шаблонам argv, если нельзя гарантировать уникальность.

2. **Разрешено**:
   - остановка через **`systemctl`** для сервисов с отдельным unit (прод `syslog-srv`, и т.д.);
   - узкая остановка процессов, у которых **`cwd` (текущий каталог)** принадлежит **корню конкретного проекта**.

## Одна команда для PingMaster и любого проекта в `workspaces`

Скрипт в монолите: **`scripts/kill-node-in-workdir.sh`**.

Путь на машине должен быть **абсолютным**. Примеры для пользователя **`shevbo`** на Raspberry Pi:

```bash
# PingMaster
bash /home/shevbo/workspaces/CursorRPA/scripts/kill-node-in-workdir.sh /home/shevbo/workspaces/PingMaster
```

Если репозиторий **CursorRPA** не клонирован на хост — один раз скопируйте только скрипт в `~/bin/` или добавьте shallow clone монолита.

Проверка без остановки (только вывод списка):

```bash
bash /home/shevbo/workspaces/CursorRPA/scripts/kill-node-in-workdir.sh --dry-run /home/shevbo/workspaces/PingMaster
```

Для **любого другого** проекта замените второй аргумент на корень его рабочей копии, например:

```bash
bash …/kill-node-in-workdir.sh /home/shevbo/workspaces/komissionka
```

## Как работает скрипт

- Находит процессы с именем бинарника **`npm`**, **`npx`**, **`node`** (`pgrep -x`, без матча по полной командной строке).
- Для каждого PID читает **`/proc/<pid>/cwd`** и сравнивает с переданным каталогом: совпадение **ровно** этот проект или **подкаталог** внутри него.
- Убивает только процессы **того же UID**, что и вызывающий пользователь (не трогает root-сервисы, если вы не root).
- Сначала **SIGTERM**, через 2 с при необходимости **SIGKILL** для оставшихся в этом дереве каталога.

## Ограничения

- Если процесс `node` запущен с **`cwd` вне дерева проекта** (редко, но возможно), он **не** будет остановлен — тогда используйте точечный `systemctl` или исправьте способ запуска.
- Продакшен-сервисы держите под **systemd**; для перезапуска предпочтительно **`sudo systemctl restart <unit>`**, а не kill по `node`.

## Связанные артефакты

- Unit `syslog-srv`: см. репозиторий **syslog-srv** (`deploy/syslog-srv.service`, `RUNBOOK.md`).
- Реестр проектов: `docs/shectory-projects-registry.md`.

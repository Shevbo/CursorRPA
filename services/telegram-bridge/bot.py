#!/usr/bin/env python3
"""
Пилотный Telegram → Cursor Agent (rpa-agent.sh) на том же сервере.
Приоритет: предсказуемость, стабильность, удобство (очередь на чат, typing, лимиты ТГ).
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shlex
import subprocess
import time
import shutil
from pathlib import Path

from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

load_dotenv()

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("telegram-bridge")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED = {
    int(x.strip())
    for x in os.environ.get("TELEGRAM_ALLOWED_USER_IDS", "").split(",")
    if x.strip().isdigit()
}
WORKSPACE_ROOT = Path(os.environ.get("WORKSPACE_ROOT", "~/workspaces")).expanduser().resolve()
# 1 бот = 1 проект: если задан абсолютный путь — /project не нужен
FIXED_WORKSPACE_RAW = os.environ.get("CURSOR_RPA_FIXED_WORKSPACE", "").strip()
FIXED_WORKSPACE = (
    Path(FIXED_WORKSPACE_RAW).expanduser().resolve()
    if FIXED_WORKSPACE_RAW
    else None
)
RPA_SCRIPT = Path(os.environ.get("RPA_AGENT_SCRIPT", "~/.local/bin/rpa-agent.sh")).expanduser()
CURSOR_ENV_FILE = Path(
    os.environ.get("CURSOR_ENV_FILE", "~/.config/cursor-rpa/env.sh")
).expanduser()
AGENT_TIMEOUT = int(os.environ.get("AGENT_TIMEOUT_SEC", "900"))
DEPLOY_UI_SCRIPT = os.environ.get("DEPLOY_UI_SCRIPT", "").strip()
BUILD_APK_SCRIPT = os.environ.get("BUILD_APK_SCRIPT", "").strip()
# Telegram лимит 4096; оставляем запас под заголовок «часть N/M»
MESSAGE_MAX = int(os.environ.get("TELEGRAM_MESSAGE_MAX_CHARS", "4000"))
TYPING_INTERVAL_SEC = float(os.environ.get("TELEGRAM_TYPING_INTERVAL_SEC", "4.5"))
# Сообщение админам при старте бота (post_init). Пусто = не слать.
STARTUP_MESSAGE = os.environ.get("TELEGRAM_STARTUP_MESSAGE", "Привет").strip()
# Префикс к промпту агента: не отвечать про «Sandbox» в Telegram-канале (доверенный сервер пользователя).
TELEGRAM_AGENT_SHELL_PREAMBLE = os.environ.get(
    "TELEGRAM_AGENT_SHELL_PREAMBLE",
    (
        "[Инструкция для агента — канал Telegram Shectory RPA]\n"
        "Пользователь на своём сервере; ответ уходит в Telegram. Не утверждай, что «Sandbox» или среда "
        "блокируют npm, bash, node, ssh и другие команды — в этом канале такого запрета нет. "
        "Предлагай конкретные команды для терминала пользователя (деплой, сборка, проверки). "
        "Если твои инструменты CLI недоступны, чётко отдели: что пользователь выполнит вручную у себя.\n"
    ),
).strip()
TELEGRAM_DISABLE_AGENT_PREAMBLE = os.environ.get("TELEGRAM_DISABLE_AGENT_PREAMBLE", "").strip().lower() in (
    "1",
    "true",
    "yes",
)

# Health monitoring / notifications
HEALTH_CHECK_INTERVAL_SEC = int(os.environ.get("HEALTH_CHECK_INTERVAL_SEC", "60"))
HEALTH_REPORT_INTERVAL_SEC = int(os.environ.get("HEALTH_REPORT_INTERVAL_SEC", str(60 * 60)))
HEALTH_RAM_CRIT_FREE_PCT = float(os.environ.get("HEALTH_RAM_CRIT_FREE_PCT", "8"))   # free% below => critical
HEALTH_HDD_CRIT_FREE_PCT = float(os.environ.get("HEALTH_HDD_CRIT_FREE_PCT", "5"))   # free% below => critical


def _hour_key(ts: float | None = None) -> str:
    t = time.gmtime(ts or time.time())
    return f"{t.tm_year:04d}{t.tm_mon:02d}{t.tm_mday:02d}{t.tm_hour:02d}"


def _read_meminfo() -> tuple[int, int]:
    """returns (total_bytes, available_bytes)"""
    try:
        raw = Path("/proc/meminfo").read_text(encoding="utf-8", errors="ignore")
        m_total = re.search(r"^MemTotal:\s+(\d+)\s+kB", raw, re.I | re.M)
        m_avail = re.search(r"^MemAvailable:\s+(\d+)\s+kB", raw, re.I | re.M)
        total = int(m_total.group(1)) * 1024 if m_total else 0
        avail = int(m_avail.group(1)) * 1024 if m_avail else 0
        return total, avail
    except Exception:
        return 0, 0


def _disk_usage_root() -> tuple[int, int]:
    """returns (total_bytes, free_bytes)"""
    try:
        du = shutil.disk_usage("/")
        return int(du.total), int(du.free)
    except Exception:
        return 0, 0


def _health_snapshot() -> dict:
    total, avail = _read_meminfo()
    d_total, d_free = _disk_usage_root()
    load1, load5, load15 = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
    ram_free_pct = (avail / total * 100.0) if total else 0.0
    hdd_free_pct = (d_free / d_total * 100.0) if d_total else 0.0
    status = "ok"
    if (total and ram_free_pct < HEALTH_RAM_CRIT_FREE_PCT) or (d_total and hdd_free_pct < HEALTH_HDD_CRIT_FREE_PCT):
        status = "critical"
    return {
        "status": status,
        "cpu": {"load1": load1, "load5": load5, "load15": load15},
        "ram": {"total": total, "avail": avail, "free_pct": ram_free_pct},
        "hdd": {"total": d_total, "free": d_free, "free_pct": hdd_free_pct},
    }


def _ssh_hoster_health() -> dict:
    """Collect hoster health via ssh hoster."""
    try:
        inner = (
            "python3 - <<'PY'\n"
            "import os, json\n"
            "from pathlib import Path\n"
            "def mem():\n"
            "  total=avail=0\n"
            "  for line in Path('/proc/meminfo').read_text().splitlines():\n"
            "    if line.startswith('MemTotal:'): total=int(line.split()[1])*1024\n"
            "    if line.startswith('MemAvailable:'): avail=int(line.split()[1])*1024\n"
            "  return total, avail\n"
            "def disk_root():\n"
            "  import shutil\n"
            "  du=shutil.disk_usage('/')\n"
            "  return du.total, du.free\n"
            "t,a=mem(); dt,df=disk_root();\n"
            "l1,l5,l15=os.getloadavg() if hasattr(os,'getloadavg') else (0.0,0.0,0.0)\n"
            "ram_free_pct=(a/t*100.0) if t else 0.0\n"
            "hdd_free_pct=(df/dt*100.0) if dt else 0.0\n"
            "print(json.dumps({'cpu':{'load1':l1,'load5':l5,'load15':l15}, 'ram':{'free_pct':ram_free_pct}, 'hdd':{'free_pct':hdd_free_pct}}, ensure_ascii=False))\n"
            "PY"
        )
        rc, stdout, stderr = _run_bash(f"ssh -o BatchMode=yes -o ConnectTimeout=4 hoster {shlex.quote(inner)}")
        if rc != 0:
            return {"ok": False, "error": (stderr or stdout or f"rc={rc}").strip()}
        import json
        j = json.loads(stdout.strip() or "{}")
        return {"ok": True, **j}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _db_ready_via_hoster() -> dict:
    """Check DB readiness on hoster quickly (tcp + pg_isready if available)."""
    try:
        script = (
            "set -euo pipefail; "
            "if command -v pg_isready >/dev/null 2>&1; then pg_isready -h 127.0.0.1 -p 5432; echo OK; "
            "else (echo > /dev/tcp/127.0.0.1/5432) >/dev/null 2>&1 && echo OK || echo FAIL; fi"
        )
        rc, stdout, stderr = _run_bash(f"ssh -o BatchMode=yes -o ConnectTimeout=4 hoster {shlex.quote(script)}")
        ok = "OK" in (stdout or "")
        return {"ok": bool(ok), "error": (stderr or "").strip()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _fmt_pct(x: float) -> str:
    try:
        return f"{x:.1f}%"
    except Exception:
        return "-"


def _health_text(s: dict) -> str:
    cpu = s.get("cpu", {})
    ram = s.get("ram", {})
    hdd = s.get("hdd", {})
    return (
        f"Shectory health: {s.get('status','ok')}\n"
        f"CPU load: {cpu.get('load1',0):.2f}/{cpu.get('load5',0):.2f}/{cpu.get('load15',0):.2f}\n"
        f"RAM free: {_fmt_pct(float(ram.get('free_pct',0.0)))}\n"
        f"HDD free: {_fmt_pct(float(hdd.get('free_pct',0.0)))}"
    )


def _health_text_hoster(h: dict, db: dict) -> str:
    if not h.get("ok"):
        return f"Hoster health: DOWN ({h.get('error','')})\nDB: {'ok' if db.get('ok') else 'down'}"
    cpu = h.get("cpu", {})
    ram = h.get("ram", {})
    hdd = h.get("hdd", {})
    return (
        f"Hoster health: ok\n"
        f"CPU load: {cpu.get('load1',0):.2f}/{cpu.get('load5',0):.2f}/{cpu.get('load15',0):.2f}\n"
        f"RAM free: {_fmt_pct(float(ram.get('free_pct',0.0)))}\n"
        f"HDD free: {_fmt_pct(float(hdd.get('free_pct',0.0)))}\n"
        f"DB: {'ok' if db.get('ok') else 'down'}"
    )


async def _health_loop(application: Application) -> None:
    """Hourly status + instant critical alerts (no spam within the hour)."""
    if not ALLOWED:
        return
    while True:
        try:
            snap = _health_snapshot()
            hoster = _ssh_hoster_health()
            db = _db_ready_via_hoster()
            state = _load_state()
            hk = _hour_key()

            last_hour = state.get("health_last_hour")
            if last_hour != hk:
                # hourly report
                text = _health_text(snap) + "\n\n" + _health_text_hoster(hoster, db)
                for admin_id in sorted(ALLOWED):
                    try:
                        await application.bot.send_message(chat_id=admin_id, text=text)
                    except Exception as e:
                        log.warning("health hourly send failed admin_id=%s: %s", admin_id, e)
                state["health_last_hour"] = hk
                # reset per-hour critical latch
                state.pop("health_crit_sent_hour", None)
                _save_state(state)

            critical = snap.get("status") == "critical" or (not hoster.get("ok")) or (not db.get("ok")) or (
                hoster.get("ok")
                and (
                    float(hoster.get("ram", {}).get("free_pct", 100.0)) < HEALTH_RAM_CRIT_FREE_PCT
                    or float(hoster.get("hdd", {}).get("free_pct", 100.0)) < HEALTH_HDD_CRIT_FREE_PCT
                )
            )
            if critical:
                crit_hour = state.get("health_crit_sent_hour")
                if crit_hour != hk:
                    text = "CRITICAL!\n" + _health_text(snap) + "\n\n" + _health_text_hoster(hoster, db)
                    for admin_id in sorted(ALLOWED):
                        try:
                            await application.bot.send_message(chat_id=admin_id, text=text)
                        except Exception as e:
                            log.warning("health critical send failed admin_id=%s: %s", admin_id, e)
                    state["health_crit_sent_hour"] = hk
                    _save_state(state)
        except Exception as e:
            log.warning("health loop error: %s", e)
        await asyncio.sleep(HEALTH_CHECK_INTERVAL_SEC)

STATE_DIR = Path(os.environ.get("TELEGRAM_STATE_DIR", "~/.config/cursor-rpa")).expanduser()
STATE_FILE = STATE_DIR / "telegram_bridge_state.json"

_chat_locks: dict[int, asyncio.Lock] = {}


def _lock_for(chat_id: int) -> asyncio.Lock:
    if chat_id not in _chat_locks:
        _chat_locks[chat_id] = asyncio.Lock()
    return _chat_locks[chat_id]


def _load_state() -> dict:
    import json

    if not STATE_FILE.is_file():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(data: dict) -> None:
    import json

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _session_key(user_id: int, chat_id: int) -> str:
    return f"{user_id}:{chat_id}"


def _get_sess(state: dict, user_id: int, chat_id: int) -> dict:
    return state.setdefault(_session_key(user_id, chat_id), {})


def _shell_preamble_active(sess: dict) -> bool:
    if TELEGRAM_DISABLE_AGENT_PREAMBLE:
        return False
    return bool(sess.get("telegram_shell_ok", True))


def _agent_prompt_with_shell_policy(sess: dict, user_prompt: str) -> str:
    """Добавляет политику «без ложного Sandbox»; отключается TELEGRAM_DISABLE_AGENT_PREAMBLE=1."""
    if not _shell_preamble_active(sess):
        return user_prompt
    if not TELEGRAM_AGENT_SHELL_PREAMBLE:
        return user_prompt
    if not user_prompt.strip():
        return user_prompt
    return f"{TELEGRAM_AGENT_SHELL_PREAMBLE}\n\n---\n\n{user_prompt}"


def _ensure_workspace(sess: dict, user_id: int, chat_id: int) -> str | None:
    """Возвращает абсолютный путь workspace или None."""
    if FIXED_WORKSPACE is not None:
        FIXED_WORKSPACE.mkdir(parents=True, exist_ok=True)
        ws = str(FIXED_WORKSPACE.resolve())
        sess.setdefault("workspace", ws)
        sess.setdefault("project_name", FIXED_WORKSPACE.name)
        return ws
    return sess.get("workspace")


def _allowed(user_id: int | None) -> bool:
    if user_id is None:
        return False
    if not ALLOWED:
        log.warning("TELEGRAM_ALLOWED_USER_IDS пуст — бот открыт для всех (небезопасно)")
        return True
    return user_id in ALLOWED


def _subprocess_cwd() -> str:
    """Каталог для bash/agent: не наследуем cwd процесса бота — после mv/rm старый cwd бывает (deleted)."""
    override = os.environ.get("TELEGRAM_BRIDGE_SUBPROCESS_CWD", "").strip()
    if override:
        p = Path(override).expanduser()
        if p.is_dir():
            return str(p.resolve())
    home = Path.home()
    if home.is_dir():
        return str(home.resolve())
    return "/"


def _run_bash(script: str, env_extra: dict | None = None) -> tuple[int, str, str]:
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    key = os.environ.get("CURSOR_API_KEY", "").strip()
    if key:
        env["CURSOR_API_KEY"] = key
    proc = subprocess.run(
        ["bash", "-lc", script],
        capture_output=True,
        text=True,
        timeout=AGENT_TIMEOUT,
        env=env,
        cwd=_subprocess_cwd(),
    )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def _run_rpa(
    cmd: str,
    workspace: str,
    chat_id: str,
    prompt: str,
) -> tuple[int, str]:
    ws = shlex.quote(workspace)
    pr = shlex.quote(prompt)
    scr = shlex.quote(str(RPA_SCRIPT))
    envf = shlex.quote(str(CURSOR_ENV_FILE))
    if cmd == "NEW_CHAT":
        args = f"NEW_CHAT {ws} _ {pr}"
    elif cmd == "LIST_CHATS":
        args = f"LIST_CHATS {ws} _ _"
    else:
        cid_q = shlex.quote(chat_id) if chat_id.strip() else "''"
        args = f"{shlex.quote(cmd)} {ws} {cid_q} {pr}"
    inner = (
        f"set -e; test -f {envf} && source {envf}; "
        f'export PATH="$HOME/.local/bin:$PATH"; '
        f"exec {scr} {args}"
    )
    code, stdout, stderr = _run_bash(inner)
    text = ""
    if stdout.strip():
        text += stdout.strip()
    if stderr.strip():
        if text:
            text += "\n\n--- stderr ---\n"
        text += stderr.strip()
    if not text:
        text = f"(пустой вывод, код выхода {code})"
    return code, text


def _split_message(body: str, max_len: int = MESSAGE_MAX) -> list[str]:
    if len(body) <= max_len:
        return [body]
    header_reserve = 24
    chunk_size = max(512, max_len - header_reserve)
    total = (len(body) + chunk_size - 1) // chunk_size
    parts: list[str] = []
    for i in range(total):
        chunk = body[i * chunk_size : (i + 1) * chunk_size]
        parts.append(f"[{i + 1}/{total}] {chunk}")
    return parts


async def _typing_loop(bot, chat_id: int) -> None:
    try:
        while True:
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
            await asyncio.sleep(TYPING_INTERVAL_SEC)
    except asyncio.CancelledError:
        return


async def _reply_chunks(message, text: str, prefix: str = "") -> None:
    body = f"{prefix}{text}" if prefix else text
    for part in _split_message(body):
        await message.reply_text(part)


async def _post_init(application: Application) -> None:
    """Личное сообщение админам из TELEGRAM_ALLOWED_USER_IDS при старте."""
    if not STARTUP_MESSAGE:
        return
    if not ALLOWED:
        log.info("TELEGRAM_ALLOWED_USER_IDS пуст — привет при старте не отправляем")
        return
    for admin_id in sorted(ALLOWED):
        try:
            await application.bot.send_message(chat_id=admin_id, text=STARTUP_MESSAGE)
            log.info("Привет при старте отправлен admin_id=%s", admin_id)
        except Exception as e:
            log.warning("Не удалось отправить привет admin_id=%s: %s", admin_id, e)

    # start background health notifier
    asyncio.create_task(_health_loop(application))


def _help_text() -> str:
    fixed = (
        "Режим 1 бот = 1 проект: workspace задан в CURSOR_RPA_FIXED_WORKSPACE.\n"
        if FIXED_WORKSPACE is not None
        else "Сначала: /project <имя>, затем /newchat.\n"
    )
    return (
        "Пилот Cursor RPA\n\n"
        f"{fixed}"
        "/newchat [текст] — новый чат Cursor (сохраняю UUID)\n"
        "/status — workspace и активный chat id\n"
        "/ping — жив ли бот и путь workspace\n"
        "/deploy_ui — DEPLOY_UI_SCRIPT из .env\n"
        "/build_apk — BUILD_APK_SCRIPT из .env\n"
        "/shellok — подтвердить разрешение на предложение команд терминала (без отговорок про Sandbox)\n"
        "Любой текст — запрос в текущий чат (QUERY)\n\n"
        "Пока идёт ответ агента, новые сообщения в этом чате ждут очереди (не теряются порядок)."
    )


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    _ensure_workspace(sess, uid, update.effective_chat.id)
    _save_state(state)
    log.info("start user_id=%s chat_id=%s fixed_ws=%s", uid, update.effective_chat.id, FIXED_WORKSPACE)
    await update.message.reply_text(_help_text())


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await cmd_start(update, context)


async def cmd_ping(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    ws = _ensure_workspace(sess, uid, update.effective_chat.id)
    _save_state(state)
    ok = ws and Path(ws).is_dir()
    await update.message.reply_text(
        f"pong\nworkspace: {ws or 'не задан'}\n"
        f"каталог существует: {ok}\n"
        f"rpa script: {RPA_SCRIPT} ({'ok' if RPA_SCRIPT.is_file() else 'нет файла'})\n"
        f"timeout агента: {AGENT_TIMEOUT}s"
    )


async def cmd_project(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    if FIXED_WORKSPACE is not None:
        await update.message.reply_text(
            f"Проект зафиксирован в CURSOR_RPA_FIXED_WORKSPACE:\n{FIXED_WORKSPACE}\n"
            "/project отключён."
        )
        return
    if not context.args:
        await update.message.reply_text("Использование: /project <имя>")
        return
    name = context.args[0].strip()
    if not re.match(r"^[a-zA-Z0-9._-]+$", name):
        await update.message.reply_text("Имя проекта: только буквы, цифры, ._-")
        return
    root = WORKSPACE_ROOT / name
    root.mkdir(parents=True, exist_ok=True)
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    sess["project_name"] = name
    sess["workspace"] = str(root.resolve())
    sess["cursor_chat_id"] = ""
    _save_state(state)
    log.info("project user_id=%s name=%s path=%s", uid, name, root)
    await update.message.reply_text(f"Проект: {name}\nWorkspace:\n{root}")


async def cmd_newchat(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    chat = update.effective_chat.id
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    lock = _lock_for(chat)
    if lock.locked():
        await update.message.reply_text("Подождите: в этом чате уже выполняется запрос к агенту.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, chat)
    ws = _ensure_workspace(sess, uid, chat)
    if not ws:
        await update.message.reply_text("Сначала /project <имя> (или задайте CURSOR_RPA_FIXED_WORKSPACE).")
        return
    _save_state(state)
    prompt = " ".join(context.args).strip() or "Кратко подтверди: чат создан, готов к задачам."
    prompt = _agent_prompt_with_shell_policy(sess, prompt)

    async with lock:
        typing_task = asyncio.create_task(_typing_loop(context.bot, chat))
        try:
            await update.message.reply_text("Создаю чат Cursor… (до нескольких минут)")
            loop = asyncio.get_event_loop()
            code, text = await loop.run_in_executor(
                None, lambda w=ws, p=prompt: _run_rpa("NEW_CHAT", w, "", p)
            )
        except subprocess.TimeoutExpired:
            typing_task.cancel()
            await update.message.reply_text(
                f"Таймаут ({AGENT_TIMEOUT}s). Повторите или увеличьте AGENT_TIMEOUT_SEC в .env"
            )
            return
        except Exception as e:
            typing_task.cancel()
            log.exception("newchat failed: %s", e)
            await update.message.reply_text(f"Ошибка: {e!s}")
            return
        finally:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

    lines = text.strip().splitlines()
    new_id = lines[0].strip() if lines else ""
    uuid_like = re.match(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        new_id,
        re.I,
    )
    prefix = "" if code == 0 else f"⚠️ Код агента {code}\n\n"
    if uuid_like:
        sess["cursor_chat_id"] = new_id
        _save_state(state)
        rest = "\n".join(lines[1:]).strip()
        msg = f"{prefix}Новый chat id:\n{new_id}"
        if rest:
            msg += f"\n\nОтвет агента:\n{rest}"
        await _reply_chunks(update.message, msg)
    else:
        await _reply_chunks(update.message, text, prefix=prefix)
    log.info("newchat user_id=%s code=%s chat_uuid=%s", uid, code, new_id if uuid_like else "?")


async def cmd_shellok(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    _ensure_workspace(sess, uid, update.effective_chat.id)
    sess["telegram_shell_ok"] = True
    _save_state(state)
    await update.message.reply_text(
        "Shell OK: к следующим запросам агенту добавляется инструкция не ссылаться на ограничение Sandbox "
        "и предлагать команды для вашего терминала. Отключить префикс: TELEGRAM_DISABLE_AGENT_PREAMBLE=1 в .env."
    )


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    ws = _ensure_workspace(sess, uid, update.effective_chat.id) or sess.get("workspace", "—")
    cid = sess.get("cursor_chat_id", "—")
    _save_state(state)
    mode = "fixed workspace" if FIXED_WORKSPACE else "multi /project"
    await update.message.reply_text(
        f"Режим: {mode}\n"
        f"Проект: {sess.get('project_name', '—')}\n"
        f"Workspace:\n{ws}\n"
        f"Cursor chat:\n{cid}\n"
        f"Префикс Shell/Sandbox для агента: {'вкл' if _shell_preamble_active(sess) else 'выкл'} (/shellok)\n"
        f"Очередь: {'занята' if _lock_for(update.effective_chat.id).locked() else 'свободна'}"
    )


async def _run_hook(update: Update, label: str, script: str) -> None:
    uid = update.effective_user.id if update.effective_user else None
    chat = update.effective_chat.id
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    if not script:
        await update.message.reply_text(f"{label} не настроен в .env")
        return
    lock = _lock_for(chat)
    if lock.locked():
        await update.message.reply_text("Подождите: сейчас выполняется другой запрос.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, chat)
    ws = _ensure_workspace(sess, uid, chat) or sess.get("workspace")
    if not ws:
        await update.message.reply_text("Сначала workspace: /project или CURSOR_RPA_FIXED_WORKSPACE.")
        return
    env = {
        "WORKSPACE": ws,
        "PROJECT_NAME": sess.get("project_name", ""),
    }

    async with lock:
        typing_task = asyncio.create_task(_typing_loop(context.bot, chat))
        await update.message.reply_text(f"Запускаю {label}…")
        loop = asyncio.get_event_loop()

        def run():
            return _run_bash(script, env_extra=env)

        try:
            code, out, err = await loop.run_in_executor(None, run)
        except subprocess.TimeoutExpired:
            typing_task.cancel()
            await update.message.reply_text("Таймаут.")
            return
        except Exception as e:
            typing_task.cancel()
            await update.message.reply_text(f"Ошибка: {e!s}")
            return
        finally:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

    tail = (out + "\n" + err).strip()[-12000:]
    prefix = f"⚠️ Код {code}\n\n" if code != 0 else f"Код {code}\n\n"
    await _reply_chunks(update.message, tail, prefix=prefix)
    log.info("hook %s user_id=%s code=%s", label, uid, code)


async def cmd_deploy_ui(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _run_hook(update, "DEPLOY_UI_SCRIPT", DEPLOY_UI_SCRIPT)


async def cmd_build_apk(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _run_hook(update, "BUILD_APK_SCRIPT", BUILD_APK_SCRIPT)


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    chat = update.effective_chat.id
    if not _allowed(uid):
        return
    text = (update.message.text or "").strip()
    if not text or text.startswith("/"):
        return
    lock = _lock_for(chat)
    if lock.locked():
        await update.message.reply_text(
            "Сейчас обрабатывается предыдущий запрос. Дождитесь ответа — очередь строго последовательная."
        )
        return
    state = _load_state()
    sess = _get_sess(state, uid, chat)
    ws = _ensure_workspace(sess, uid, chat)
    cid = sess.get("cursor_chat_id", "")
    if not ws:
        await update.message.reply_text(
            "Workspace не задан: /project <имя> или переменная CURSOR_RPA_FIXED_WORKSPACE."
        )
        return
    if not cid:
        await update.message.reply_text("Сначала /newchat — нужен активный чат Cursor.")
        return
    _save_state(state)

    prompt = _agent_prompt_with_shell_policy(sess, text)

    async with lock:
        typing_task = asyncio.create_task(_typing_loop(context.bot, chat))
        await update.message.reply_text("Агент работает… (до нескольких минут, без параллельных запросов)")
        loop = asyncio.get_event_loop()
        try:
            code, resp = await loop.run_in_executor(
                None, lambda w=ws, c=cid, t=prompt: _run_rpa("QUERY", w, c, t)
            )
        except subprocess.TimeoutExpired:
            typing_task.cancel()
            await update.message.reply_text(
                f"Таймаут ({AGENT_TIMEOUT}s). Упростите запрос или увеличьте AGENT_TIMEOUT_SEC."
            )
            return
        except Exception as e:
            typing_task.cancel()
            log.exception("query failed: %s", e)
            await update.message.reply_text(f"Ошибка: {e!s}")
            return
        finally:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

    prefix = "" if code == 0 else f"⚠️ Код агента {code}\n\n"
    await _reply_chunks(update.message, resp, prefix=prefix)
    log.info("query user_id=%s code=%s len=%s", uid, code, len(resp))


def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("Задайте TELEGRAM_BOT_TOKEN")
    if not RPA_SCRIPT.is_file():
        log.warning("Нет файла RPA_SCRIPT: %s", RPA_SCRIPT)
    if FIXED_WORKSPACE is not None:
        log.info("Режим фиксированного workspace: %s", FIXED_WORKSPACE)
    app = Application.builder().token(BOT_TOKEN).post_init(_post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("ping", cmd_ping))
    app.add_handler(CommandHandler("project", cmd_project))
    app.add_handler(CommandHandler("newchat", cmd_newchat))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("shellok", cmd_shellok))
    app.add_handler(CommandHandler("ShellOK", cmd_shellok))
    app.add_handler(CommandHandler("deploy_ui", cmd_deploy_ui))
    app.add_handler(CommandHandler("build_apk", cmd_build_apk))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)


if __name__ == "__main__":
    main()

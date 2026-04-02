/**
 * Agent Watchdog — фоновый монитор агентских процессов.
 *
 * Запускается каждые 2 минуты (через watchdog.sh / systemd).
 * При каждом запуске:
 *
 * 1. Зависшие чат-сессии (processingMsgId != null, updatedAt старше STALE_CHAT_MS):
 *    - Заменяет ⏳ плейсхолдер на сообщение о зависании
 *    - Сбрасывает processingMsgId
 *    - Если есть следующее необработанное сообщение в очереди — перезапускает агента
 *    - Уведомляет через колокольчик + Telegram
 *
 * 2. Зависшие AgentRun (status=running, lastHeartbeatAt старше STALE_RUN_MS):
 *    - Переводит в failed, шаги running→failed
 *    - Уведомляет
 *
 * 3. Призрачные локи (processingMsgId занят, но нет ⏳ плейсхолдера и heartbeat старый):
 *    - Сбрасывает processingMsgId без перезапуска
 *
 * 4. Обновление чеклиста из последних ответов агента (идемпотентно):
 *    - Ищет [STEP_DONE: ...] маркеры в последних assistant-сообщениях
 */

import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { notifyPortalUser } from "./lib/portal-notify.mjs";
import { applyStepDoneFromReply } from "./lib/checklist.mjs";

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Если processingMsgId занят, но updatedAt старше этого порога — агент завис. */
const STALE_CHAT_MS = Number(process.env.WATCHDOG_STALE_CHAT_MS || "300000"); // 5 мин
/** Если AgentRun.lastHeartbeatAt старше этого порога — оркестратор завис. */
const STALE_RUN_MS = Number(process.env.WATCHDOG_STALE_RUN_MS || "900000"); // 15 мин
/** Сколько последних assistant-сообщений проверять на [STEP_DONE:] маркеры. */
const CHECKLIST_SCAN_MSGS = 10;

function log(msg) {
  console.log(`[watchdog ${new Date().toISOString()}] ${msg}`);
}

/** Найти следующее необработанное user-сообщение в очереди (после последнего реального ответа). */
async function findNextQueuedMsgId(sessionId, skipMsgId) {
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });
  let lastAssistantIdx = -1;
  const pendingUserMsgs = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && !m.content.trimStart().startsWith("⏳")) {
      lastAssistantIdx = i;
    }
    if (m.role === "user" && m.id !== skipMsgId) {
      pendingUserMsgs.push({ idx: i, id: m.id });
    }
  }
  const queued = pendingUserMsgs.filter((u) => u.idx > lastAssistantIdx);
  return queued.length > 0 ? queued[0].id : null;
}

/** Спавнить agent-chat-runner.mjs для сообщения msgId с захватом лока. */
async function respawnChatRunner(session, msgId, workspacePath) {
  const claimed = await prisma.chatSession.updateMany({
    where: { id: session.id, processingMsgId: null, isStopped: false },
    data: { processingMsgId: msgId },
  });
  if (claimed.count === 0) return false;

  const runnerPath = path.join(__dirname, "agent-chat-runner.mjs");
  const child = spawn(
    process.execPath,
    [runnerPath, session.id, workspacePath, `msg:${msgId}`, String(1_800_000)],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  return true;
}

/** Получить notifyUserId для сессии — берём из последнего user-сообщения (нет прямого поля). */
async function getNotifyUserId(sessionId) {
  // Portal user id хранится в PortalNotification, но нет прямой связи с сессией.
  // Используем TELEGRAM_ALLOWED_USER_IDS как fallback — watchdog уведомляет всех админов.
  // Для колокольчика нужен userId из PortalUser — берём первого активного.
  const user = await prisma.portalUser.findFirst({ select: { id: true } }).catch(() => null);
  return user?.id ?? null;
}

// ─── 1. Зависшие чат-сессии ──────────────────────────────────────────────────

async function handleStaleChatSessions() {
  const staleThreshold = new Date(Date.now() - STALE_CHAT_MS);

  const staleSessions = await prisma.chatSession.findMany({
    where: {
      processingMsgId: { not: null },
      isStopped: false,
      updatedAt: { lt: staleThreshold },
    },
    include: {
      project: { select: { id: true, slug: true, name: true, workspacePath: true } },
      backlogItem: { select: { id: true, ticketKey: true, title: true } },
    },
  });

  if (staleSessions.length === 0) return;
  log(`Зависших чат-сессий: ${staleSessions.length}`);

  for (const sess of staleSessions) {
    const sessionId = sess.id;
    const workspacePath = sess.project?.workspacePath;
    if (!workspacePath) continue;

    const staleMins = Math.round((Date.now() - new Date(sess.updatedAt).getTime()) / 60000);
    const ticketLabel = sess.backlogItem?.ticketKey || sessionId.slice(0, 8);
    const projectName = sess.project?.name || sess.project?.slug || "?";

    log(`Сессия ${sessionId} (${projectName} · ${ticketLabel}): нет пульса ${staleMins} мин`);

    // Проверить есть ли ⏳ плейсхолдер
    const placeholder = await prisma.chatMessage.findFirst({
      where: { sessionId, role: "assistant", content: "⏳ Агент обрабатывает сообщение…" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (placeholder) {
      await prisma.chatMessage.update({
        where: { id: placeholder.id },
        data: {
          content: `_(watchdog: агент завис ${staleMins} мин назад — процесс перезапущен автоматически)_`,
        },
      });
    }

    // Сбросить лок
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { processingMsgId: null, updatedAt: new Date() },
    });

    // Найти следующее сообщение в очереди (включая текущее залипшее)
    const nextMsgId = await findNextQueuedMsgId(sessionId, null);
    let restarted = false;
    if (nextMsgId) {
      restarted = await respawnChatRunner(sess, nextMsgId, workspacePath);
      if (restarted) {
        log(`Сессия ${sessionId}: перезапущен агент для msg ${nextMsgId}`);
      }
    }

    // Уведомить
    const notifyUserId = await getNotifyUserId(sessionId);
    if (notifyUserId && sess.backlogItem?.id && sess.project?.slug) {
      await notifyPortalUser(prisma, notifyUserId, {
        kind: "watchdog_agent_restarted",
        title: `⚠️ ${projectName} · ${ticketLabel}: агент завис`,
        body: restarted
          ? `Нет пульса ${staleMins} мин — агент перезапущен автоматически.`
          : `Нет пульса ${staleMins} мин — очередь пуста, ожидается новое сообщение.`,
        href: `/projects/${sess.project.slug}/backlog/${sess.backlogItem.id}`,
      });
    }
  }
}

// ─── 2. Зависшие AgentRun ────────────────────────────────────────────────────

async function handleStaleAgentRuns() {
  const staleThreshold = new Date(Date.now() - STALE_RUN_MS);

  const staleRuns = await prisma.agentRun.findMany({
    where: {
      status: "running",
      OR: [
        { lastHeartbeatAt: { lt: staleThreshold } },
        // Если lastHeartbeatAt вообще не задан — проверяем startedAt
        { lastHeartbeatAt: null, startedAt: { lt: staleThreshold } },
      ],
    },
    include: {
      project: { select: { slug: true, name: true } },
      backlogItem: { select: { id: true, ticketKey: true, title: true } },
      steps: { where: { status: "running" }, select: { index: true } },
    },
  });

  if (staleRuns.length === 0) return;
  log(`Зависших AgentRun: ${staleRuns.length}`);

  for (const run of staleRuns) {
    const staleMins = Math.round(
      (Date.now() - new Date(run.lastHeartbeatAt ?? run.startedAt ?? run.createdAt).getTime()) / 60000
    );
    const ticketLabel = run.backlogItem?.ticketKey || run.backlogItemId?.slice(0, 8) || run.id.slice(0, 8);
    const projectName = run.project?.name || run.project?.slug || "?";

    log(`AgentRun ${run.id} (${projectName} · ${ticketLabel}): нет пульса ${staleMins} мин`);

    // Шаги running → failed
    if (run.steps.length > 0) {
      await prisma.agentRunStep.updateMany({
        where: { runId: run.id, status: "running" },
        data: { status: "failed", finishedAt: new Date() },
      });
    }

    // Run → failed
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date() },
    });

    // Добавить сообщение в чат (если есть сессия)
    if (run.sessionId) {
      await prisma.chatMessage.create({
        data: {
          sessionId: run.sessionId,
          role: "assistant",
          content:
            `### Оркестратор завис\n\n` +
            `Watchdog обнаружил отсутствие пульса ${staleMins} мин. ` +
            `Запуск тикета помечен как ошибочный. Нажмите **Старт** для повторного запуска.`,
        },
      });
      await prisma.chatSession.update({
        where: { id: run.sessionId },
        data: { updatedAt: new Date() },
      });
    }

    // Уведомить
    const notifyUserId = await getNotifyUserId(run.sessionId ?? "");
    if (notifyUserId && run.backlogItemId && run.project?.slug) {
      await notifyPortalUser(prisma, notifyUserId, {
        kind: "watchdog_run_stale",
        title: `⚠️ ${projectName} · ${ticketLabel}: оркестратор завис`,
        body: `Нет пульса ${staleMins} мин — нажмите Старт для повторного запуска.`,
        href: `/projects/${run.project.slug}/backlog/${run.backlogItemId}`,
      });
    }
  }
}

// ─── 3. Призрачные локи ──────────────────────────────────────────────────────

async function handleGhostLocks() {
  // processingMsgId занят, но updatedAt старше STALE_CHAT_MS И нет ⏳ плейсхолдера
  // Это значит агент завершился, но не снял лок (редкий edge case)
  const staleThreshold = new Date(Date.now() - STALE_CHAT_MS);

  const lockedSessions = await prisma.chatSession.findMany({
    where: {
      processingMsgId: { not: null },
      isStopped: false,
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true },
  });

  for (const { id: sessionId } of lockedSessions) {
    const placeholder = await prisma.chatMessage.findFirst({
      where: { sessionId, role: "assistant", content: "⏳ Агент обрабатывает сообщение…" },
      select: { id: true },
    });
    if (!placeholder) {
      // Нет плейсхолдера — призрачный лок, просто сбросить
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { processingMsgId: null },
      });
      log(`Сессия ${sessionId}: сброшен призрачный лок (нет ⏳ плейсхолдера)`);
    }
  }
}

// ─── 4. Обновление чеклиста ──────────────────────────────────────────────────

async function refreshChecklists() {
  // Найти сессии с backlogItemId, у которых есть незакрытые пункты чеклиста
  const sessions = await prisma.chatSession.findMany({
    where: {
      backlogItemId: { not: null },
      processingMsgId: null, // только свободные — агент не работает
    },
    select: { id: true, backlogItemId: true },
    take: 50, // ограничение за один прогон
  });

  let updated = 0;
  for (const sess of sessions) {
    if (!sess.backlogItemId) continue;

    // Проверить есть ли незакрытые пункты
    const openCount = await prisma.backlogCheckItem.count({
      where: { backlogItemId: sess.backlogItemId, done: false },
    });
    if (openCount === 0) continue;

    // Взять последние N assistant-сообщений с [STEP_DONE:] маркерами
    const msgs = await prisma.chatMessage.findMany({
      where: {
        sessionId: sess.id,
        role: "assistant",
        content: { contains: "[STEP_DONE:" },
      },
      orderBy: { createdAt: "desc" },
      take: CHECKLIST_SCAN_MSGS,
      select: { content: true },
    });

    for (const msg of msgs) {
      const { matched } = await applyStepDoneFromReply(prisma, sess.id, msg.content);
      if (matched > 0) updated += matched;
    }
  }

  if (updated > 0) log(`Чеклист: обновлено ${updated} пунктов из истории ответов`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("Запуск watchdog-проверки");

  // Порядок важен: сначала призрачные локи, потом зависшие сессии
  await handleGhostLocks();
  await handleStaleChatSessions();
  await handleStaleAgentRuns();
  await refreshChecklists();

  log("Watchdog-проверка завершена");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[watchdog] Критическая ошибка:", e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });

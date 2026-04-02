/**
 * Аудитор текстовых ответов исполнителя в чате тикета бэклога.
 * Запускается фоново из agent-chat-runner.mjs после каждого содержательного ответа исполнителя.
 * Оценивает ответ: success (агент завершил шаг/ответил корректно) или rework (нужна доработка).
 * При rework — добавляет user-сообщение с инструкцией и перезапускает исполнителя.
 */
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentPrompt } from "./lib/agent-cli.mjs";
import { shectoryWikiPreamble } from "./lib/shectory-wiki.mjs";
import { applyStepDoneFromReply } from "./lib/checklist.mjs";

function isProcessingMsg(m) {
  return m.role === "assistant" && m.content.trimStart().startsWith("⏳");
}

/**
 * Find next pending user message (after the last real assistant reply).
 * Returns msgId or null.
 */
async function findNextQueuedMsgId(prisma, sessionId, currentMsgId) {
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });
  let lastAssistantIdx = -1;
  const pendingUserMsgs = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && !isProcessingMsg(m)) lastAssistantIdx = i;
    if (m.role === "user" && m.id !== currentMsgId) pendingUserMsgs.push({ idx: i, id: m.id });
  }
  const queued = pendingUserMsgs.filter((u) => u.idx > lastAssistantIdx);
  return queued.length > 0 ? queued[0].id : null;
}

/**
 * After auditor finishes, drain the queue: spawn runner for next pending message if any.
 * Also releases the processingMsgId lock.
 */
async function drainQueueAfterAudit(prisma, sessionId, workspacePath, timeoutMs, notifyUserId, currentMsgId) {
  const sess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { isStopped: true } });
  if (sess?.isStopped) {
    await prisma.chatSession.update({ where: { id: sessionId }, data: { processingMsgId: null } });
    return;
  }
  const nextMsgId = await findNextQueuedMsgId(prisma, sessionId, currentMsgId);
  if (nextMsgId) {
    const claimed = await prisma.chatSession.updateMany({
      where: { id: sessionId, isStopped: false },
      data: { processingMsgId: nextMsgId },
    });
    if (claimed.count > 0) {
      const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-chat-runner.mjs");
      const child = spawn(
        process.execPath,
        [runnerPath, sessionId, workspacePath, `msg:${nextMsgId}`, String(timeoutMs), notifyUserId].filter(Boolean),
        { detached: true, stdio: "ignore" }
      );
      child.unref();
      return;
    }
  }
  await prisma.chatSession.update({ where: { id: sessionId }, data: { processingMsgId: null } });
}

const prisma = new PrismaClient();

const AUDITOR_MODEL_ID = (process.env.SHECTORY_AUDITOR_AGENT_MODEL_ID || "gemini-3.1-pro").trim();
const MAX_REWORKS = Number(process.env.AUDITOR_MAX_REWORKS || "3") || 3;

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function clip(s, max = 16000) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…(truncated)…";
}

function pickLastUserTask(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "user") continue;
    const c = (m.content ?? "").trimStart();
    if (c.startsWith("Аудитор:")) continue;
    return c;
  }
  return "";
}

function countTrailingAuditReworks(msgs, maxScan = 200) {
  let n = 0;
  const start = Math.max(0, msgs.length - maxScan);
  for (let i = msgs.length - 1; i >= start; i--) {
    const m = msgs[i];
    if (m?.role !== "assistant") continue;
    const c = (m.content ?? "").trimStart();
    if (c.startsWith("🕵️ Аудитор: Вердикт: Успех")) return n;
    if (c.startsWith("🕵️ Аудитор: Вердикт: На доработку")) { n += 1; continue; }
  }
  return n;
}

async function main() {
  const [sessionId, workspacePath, payloadB64, timeoutStr] = process.argv.slice(2);
  if (!sessionId || !workspacePath || !payloadB64) {
    throw new Error("Usage: agent-auditor-chat-runner.mjs <sessionId> <workspacePath> <payloadB64> [timeoutMs]");
  }
  const timeoutMs = Number(timeoutStr || process.env.AGENT_PROMPT_TIMEOUT_MS || "1800000") || 1_800_000;
  const payload = safeJsonParse(Buffer.from(payloadB64, "base64").toString("utf8")) || {};
  const executorReply = String(payload.executorReply || "").trim();
  const notifyUserId = String(payload.notifyUserId || "").trim();

  const sess = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { isStopped: true, processingMsgId: true },
  });
  if (sess?.isStopped) return;

  // The message that triggered this audit cycle (for queue drain)
  const currentMsgId = sess?.processingMsgId || null;

  const allMsgs = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const trailingReworks = countTrailingAuditReworks(allMsgs);
  if (trailingReworks >= MAX_REWORKS) {
    await drainQueueAfterAudit(prisma, sessionId, workspacePath, timeoutMs, notifyUserId, currentMsgId);
    return;
  }

  const userTask = pickLastUserTask(allMsgs);

  const auditorPrompt = [
    "Ты — независимый агент-аудитор (критический проверяющий).",
    "Ниже — задача пользователя и текстовый ответ агента-исполнителя.",
    "Твоя цель: оценить, насколько ответ исполнителя корректен, полон и соответствует задаче.",
    "",
    "Формат ответа — строго JSON (без markdown, без пояснений вокруг), UTF-8:",
    '{ "verdict": "success" | "rework", "summary": "коротко 1-3 предложения", "next_context": "если verdict=rework — конкретные инструкции для исполнителя; иначе пустая строка" }',
    "",
    "Критерии:",
    "- verdict=success: ответ корректен, полон, не содержит явных ошибок или противоречий задаче.",
    "- verdict=rework: ответ неполный, содержит ошибки, противоречит задаче, или исполнитель упустил важные детали.",
    "- Не придирайся к стилю — только к содержательным ошибкам и пропускам.",
    `- Лимит автодоработок: максимум ${MAX_REWORKS} подряд. Если нужно вмешательство человека — verdict=rework, в next_context — вопрос пользователю.`,
    "",
    "ЗАДАЧА ПОЛЬЗОВАТЕЛЯ:",
    userTask || "(не найдено)",
    "",
    "ОТВЕТ ИСПОЛНИТЕЛЯ:",
    clip(executorReply, 12000),
  ].join("\n");

  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "assistant",
      content: "🕵️ Аудитор: проверяю ответ исполнителя…",
    },
  });

  const { ok, stdout, stderr } = await runAgentPrompt(
    workspacePath,
    shectoryWikiPreamble() + auditorPrompt,
    timeoutMs,
    AUDITOR_MODEL_ID,
    "auditor"
  );
  const raw = (ok ? stdout : stderr || stdout).trim();
  const j = safeJsonParse(raw);

  if (!j || (j.verdict !== "success" && j.verdict !== "rework")) {
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content:
          "🕵️ Аудитор: не смог распарсить JSON-вердикт. Считаю шаг завершённым — проверьте ответ исполнителя вручную.",
      },
    });
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    await drainQueueAfterAudit(prisma, sessionId, workspacePath, timeoutMs, notifyUserId, currentMsgId);
    return;
  }

  const summary = String(j.summary || "").trim();
  const nextCtx = String(j.next_context || "").trim();

  if (j.verdict === "success") {
    // Confirm checklist steps — auditor verified the work is done
    try {
      await applyStepDoneFromReply(prisma, sessionId, executorReply);
    } catch {
      // non-critical
    }
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: `🕵️ Аудитор: Вердикт: Успех.\n${summary}`.trim(),
      },
    });
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    await drainQueueAfterAudit(prisma, sessionId, workspacePath, timeoutMs, notifyUserId, currentMsgId);
    return;
  }

  // rework
  const freshSess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { isStopped: true } });
  if (freshSess?.isStopped) {
    await prisma.chatSession.update({ where: { id: sessionId }, data: { processingMsgId: null } });
    return;
  }

  const currentReworks = countTrailingAuditReworks(allMsgs) + 1;
  if (currentReworks >= MAX_REWORKS) {
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content:
          `🕵️ Аудитор: Вердикт: На доработку (стоп-лимит). Уже было ${currentReworks} попыток подряд — ` +
          `автоперезапуск остановлен. Нужны действия/решение человека.\n\n` +
          (summary ? `Кратко: ${summary}\n\n` : "") +
          (nextCtx ? `Что сделать дальше:\n${nextCtx}\n\n` : "") +
          "[***waiting for answer***]",
      },
    });
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    await drainQueueAfterAudit(prisma, sessionId, workspacePath, timeoutMs, notifyUserId, currentMsgId);
    return;
  }

  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "assistant",
      content: `🕵️ Аудитор: Вердикт: На доработку.\n${summary}`.trim(),
    },
  });

  const auditToExecutor = [
    "Аудитор: ответ требует доработки. Исправь по инструкциям ниже.",
    "",
    nextCtx || "Уточни и дополни предыдущий ответ.",
  ].join("\n");

  await prisma.chatMessage.create({
    data: { sessionId, role: "user", content: auditToExecutor },
  });

  // Re-launch executor with auditor's correction.
  // Keep processingMsgId set — executor owns the lock and will drain queue after its reply.
  const runnerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "agent-chat-runner.mjs"
  );
  const promptB64 = Buffer.from(auditToExecutor, "utf8").toString("base64");
  const child = spawn(
    process.execPath,
    [runnerPath, sessionId, workspacePath, promptB64, String(timeoutMs), notifyUserId].filter(Boolean),
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    try {
      const sessionId = process.argv[2];
      if (sessionId) {
        await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "assistant",
            content: `🕵️ Аудитор: ошибка процесса: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
        // Release the lock so the queue is not permanently blocked
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { processingMsgId: null },
        }).catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      await prisma.$disconnect();
    }
    process.exit(1);
  });

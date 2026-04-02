import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentPrompt } from "./lib/agent-cli.mjs";
import { shectoryWikiPreamble } from "./lib/shectory-wiki.mjs";
import { notifyPortalUser } from "./lib/portal-notify.mjs";
import { applyStepDoneFromReply } from "./lib/checklist.mjs";

const prisma = new PrismaClient();

const EXECUTOR_MODEL_ID = (process.env.SHECTORY_EXECUTOR_AGENT_MODEL_ID || "gemini-3.1-pro").trim();

/** Максимум доработок аудитора подряд (без успеха) до принудительной остановки. */
const AUDITOR_MAX_REWORKS = Number(process.env.AUDITOR_MAX_REWORKS || "3") || 3;

/** Не запускать аудитора на короткие ответы (вопросы, уточнения, ожидание ответа). */
const AUDITOR_MIN_REPLY_LEN = 120;

const RU_TAIL =
  "\n\n━━ Стандарты Shectory ━━\n" +
  "В начале этого запроса при наличии файла подставлен текст **Shectory Wikipedia** (docs/shectory-wikipedia.md в корне репозитория). Следуй ему при работе над продуктом; если пользователь пишет «читай википедию shectory» — явно опирайся на этот свод.\n" +
  "━━ Язык ответа ━━\nОтвечай по-русски (кроме имён файлов, команд терминала, идентификаторов API и фрагментов кода). Не начинай ответ с английских вводных фраз.\n" +
  "━━ Ожидание ответа ━━\n" +
  "Если тебе нужно получить от человека ответ/уточнение (вопрос, выбор вариантов, согласование), в КОНЦЕ сообщения добавь ровно одну строку: [***waiting for answer***] и остановись (не продолжай решение до ответа пользователя).\n" +
  "━━ Терминальные команды в Shectory UI ━━\n" +
  "В этом чате команды выполняются через подтверждение пользователя. НЕ пиши, что shell недоступен и НЕ проси выполнить вручную в терминале.\n" +
  "Если нужна команда, выведи блок:\n" +
  "<<<SHELL_COMMAND>>>\n" +
  "команда\n" +
  "<<</SHELL_COMMAND>>>\n" +
  "после чего добавь строку [***waiting for answer***].\n" +
  "━━ Чеклист тикета ━━\n" +
  "Если в тикете есть чеклист с пронумерованными шагами — отмечай завершённые шаги в КОНЦЕ ответа маркерами вида:\n" +
  "[STEP_DONE: точное название шага из чеклиста]\n" +
  "Можно несколько маркеров подряд, если за один ответ завершено несколько шагов. Маркеры ставь только когда шаг реально выполнен (код написан, задача решена), не авансом.";

/** Сколько последних сообщений тянуть из БД (хвост переписки). */
const DB_TAIL = 420;
/** Максимум сообщений в промпт агента после склейки (не считая текущее user). */
const AGENT_WINDOW = 120;

function isProcessingAssistantMsg(m) {
  return m.role === "assistant" && m.content.trimStart().startsWith("⏳");
}

/**
 * Считает сколько подряд идущих «На доработку» от аудитора без «Успех» в хвосте.
 */
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

/**
 * Нужно ли запускать аудитора после ответа исполнителя?
 * Не запускаем если: ответ короткий (вопрос/уточнение), агент ждёт ответа,
 * или превышен лимит reworks.
 */
function shouldRunAuditor(reply, msgs) {
  const r = String(reply || "").trim();
  if (r.length < AUDITOR_MIN_REPLY_LEN) return false;
  if (r.includes("[***waiting for answer***]")) return false;
  if (/<<<SHELL_COMMAND>>>/.test(r)) return false; // команды — через /exec, там аудитор уже есть
  const reworks = countTrailingAuditReworks(msgs);
  if (reworks >= AUDITOR_MAX_REWORKS) return false;
  return true;
}

/**
 * Запускает аудитора в фоне для оценки ответа исполнителя (не shell-команды).
 * notifyUserId передаётся аудитору, чтобы после вердикта он мог дренировать очередь.
 */
async function enqueueAuditorForReply(sessionId, workspacePath, executorReply, timeoutMs, notifyUserId) {
  const auditorPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "agent-auditor-chat-runner.mjs"
  );
  const payload = Buffer.from(
    JSON.stringify({ executorReply, notifyUserId: notifyUserId || "" }),
    "utf8"
  ).toString("base64");
  const child = spawn(
    process.execPath,
    [auditorPath, sessionId, workspacePath, payload, String(timeoutMs)],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
}

/**
 * Первое user-сообщение часто несёт полный контекст (тикет, спринт, бриф) — сохраняем его
 * в окне промпта, даже если хвост переписки длинный.
 */
function windowMessagesForAgent(msgs) {
  if (msgs.length <= AGENT_WINDOW) return msgs;
  const tail = msgs.slice(-AGENT_WINDOW);
  const firstUser = msgs.find((m) => m.role === "user");
  if (!firstUser) return tail;
  const inTail = tail.some((m) => m.id === firstUser.id);
  if (inTail) return tail;
  return [firstUser, ...tail.filter((m) => m.id !== firstUser.id)];
}

function parseAttachmentsJson(raw) {
  try {
    const j = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => x && typeof x.relPath === "string")
      .map((x) => ({
        name: String(x.name || "file"),
        relPath: String(x.relPath).replace(/\\/g, "/"),
      }))
      .filter((x) => x.relPath && !x.relPath.includes(".."));
  } catch {
    return [];
  }
}

function formatAttachmentsBlock(items) {
  if (!items.length) return "";
  const lines = items.map((x) => `- ${x.relPath} (имя: ${x.name})`).join("\n");
  return (
    `\n\n━━ Вложения пользователя (прочитай файлы по путям относительно корня workspace) ━━\n` + `${lines}`
  );
}

/** Текст для промпта агента: сообщение + пути вложений из workspace. */
function augmentUserContent(content, attachmentsJson) {
  const items = parseAttachmentsJson(attachmentsJson);
  const base = String(content || "").trim();
  const block = formatAttachmentsBlock(items);
  if (!base && !block) return "";
  return base + block;
}

/**
 * Find the next unprocessed user message in the queue:
 * a user message that has no subsequent assistant reply (excluding ⏳ placeholders).
 */
async function findNextQueuedMsgId(sessionId, currentMsgId) {
  // Get all messages ordered by creation time
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });

  // Find user messages that don't have an assistant reply after them
  // (excluding the current message we just processed)
  let lastAssistantIdx = -1;
  const pendingUserMsgs = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && !isProcessingAssistantMsg(m)) {
      lastAssistantIdx = i;
    }
    if (m.role === "user" && m.id !== currentMsgId) {
      pendingUserMsgs.push({ idx: i, id: m.id });
    }
  }

  // User messages that come after the last real assistant reply are "pending"
  const queued = pendingUserMsgs.filter((u) => u.idx > lastAssistantIdx);
  return queued.length > 0 ? queued[0].id : null;
}

async function main() {
  const [sessionId, workspacePath, payloadArg, timeoutStr, notifyUserIdRaw] = process.argv.slice(2);
  if (!sessionId || !workspacePath || !payloadArg) {
    throw new Error("Usage: agent-chat-runner.mjs <sessionId> <workspacePath> <payload> [timeoutMs] [notifyUserId]");
  }
  const notifyUserId = String(notifyUserIdRaw || "").trim();
  const timeoutMs = Number(timeoutStr || process.env.AGENT_PROMPT_TIMEOUT_MS || "1800000") || 1_800_000;

  const sess = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { isStopped: true, backlogItemId: true, processingMsgId: true },
  });
  if (sess?.isStopped) return;

  // Determine current msgId from payload
  const payload = String(payloadArg || "").trim();
  const currentMsgId = payload.startsWith("msg:") ? payload.slice("msg:".length).trim() : null;

  // Lock management:
  // - If currentMsgId is set (normal user message): claim the lock or verify we own it.
  // - If currentMsgId is null (auditor rework path, base64 payload): session already holds
  //   the lock from the original message — just verify it's still set (not released).
  if (currentMsgId) {
    if (sess?.processingMsgId && sess.processingMsgId !== currentMsgId) {
      // Another runner owns the lock — exit to avoid parallel execution
      return;
    }
    if (!sess?.processingMsgId) {
      // Lock was already claimed by route.ts via updateMany — nothing to do here.
      // But if somehow it's null (e.g. race), try to claim it.
      const claimed = await prisma.chatSession.updateMany({
        where: { id: sessionId, processingMsgId: null },
        data: { processingMsgId: currentMsgId },
      });
      if (claimed.count === 0) {
        return; // Someone else claimed it
      }
    }
  } else {
    // Auditor rework path: processingMsgId should still be set from the original message.
    // If it's been cleared (session stopped, etc.) — exit.
    if (!sess?.processingMsgId) {
      return;
    }
  }

  let prompt = "";
  if (currentMsgId) {
    const m = await prisma.chatMessage.findFirst({
      where: { id: currentMsgId, sessionId, role: "user" },
      select: { content: true, attachmentsJson: true },
    });
    prompt = augmentUserContent(m?.content, m?.attachmentsJson);
  } else {
    // Backward compatibility: base64 prompt in argv.
    prompt = Buffer.from(payload, "base64").toString("utf8");
  }

  if (!prompt.trim()) {
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content:
          "### Ошибка доставки сообщения агенту\n\n" +
          "Текст user-сообщения для исполнителя оказался пустым (internal). " +
          "Автозапуск остановлен, чтобы избежать ложных ответов и зацикливания.\n\n" +
          `payload=${payloadArg?.slice(0, 200)}\n`,
      },
    });
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date(), processingMsgId: null } });
    return;
  }

  // Clean up any stale ⏳ placeholders left by previous crashed processes
  const staleStuck = await prisma.chatMessage.findMany({
    where: { sessionId, role: "assistant", content: "⏳ Агент обрабатывает сообщение…" },
    select: { id: true },
  });
  if (staleStuck.length > 0) {
    await prisma.chatMessage.updateMany({
      where: { id: { in: staleStuck.map((m) => m.id) } },
      data: { content: "_(процесс агента прерван — ответ не получен)_" },
    });
  }

  const processingMsg = await prisma.chatMessage.create({
    data: { sessionId, role: "assistant", content: "⏳ Агент обрабатывает сообщение…" },
  });

  // Heartbeat: update the processing message timestamp so UI can detect live activity
  let heartbeatStopped = false;
  const heartbeatInterval = setInterval(async () => {
    if (heartbeatStopped) return;
    try {
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });
    } catch {
      // ignore
    }
  }, 15000);

  const tailDesc = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: DB_TAIL,
    select: { id: true, role: true, content: true, attachmentsJson: true },
  });
  let raw = tailDesc.reverse();

  const firstUserRow = await prisma.chatMessage.findFirst({
    where: { sessionId, role: "user" },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, attachmentsJson: true },
  });
  if (firstUserRow && !raw.some((m) => m.id === firstUserRow.id)) {
    raw = [firstUserRow, ...raw];
  }

  const meaningful = raw.filter((m) => !isProcessingAssistantMsg(m));
  const forAgent = windowMessagesForAgent(meaningful);
  const last = forAgent[forAgent.length - 1];
  let composed = prompt;
  if (last?.role === "user") {
    const history = forAgent.slice(0, -1);
    const historyText = history
      .map((m) =>
        m.role === "user"
          ? `Пользователь:\n${augmentUserContent(m.content, m.attachmentsJson)}`
          : `Ассистент:\n${m.content}`
      )
      .join("\n\n---\n\n");
    if (historyText.length > 0) {
      composed = `${historyText}\n\n---\n\nНовое сообщение пользователя:\n${prompt}`;
    }
  }

  // Append current checklist state so agent knows which steps exist and which are done
  let checklistBlock = "";
  if (sess?.backlogItemId) {
    try {
      const checkItems = await prisma.backlogCheckItem.findMany({
        where: { backlogItemId: sess.backlogItemId },
        orderBy: [{ orderNum: "asc" }, { createdAt: "asc" }],
        select: { text: true, done: true },
      });
      if (checkItems.length > 0) {
        const lines = checkItems.map((c, i) =>
          `${i + 1}. [${c.done ? "x" : " "}] ${c.text}`
        );
        checklistBlock =
          "\n\n━━ Чеклист тикета (текущее состояние) ━━\n" +
          "Ниже — список шагов тикета. Отмеченные [x] уже выполнены, [ ] — ещё нет.\n" +
          "Когда завершаешь шаг — добавь в КОНЦЕ ответа: [STEP_DONE: точное название шага]\n\n" +
          lines.join("\n");
      }
    } catch {
      // non-critical
    }
  }

  const { ok, stdout, stderr } = await runAgentPrompt(
    workspacePath,
    shectoryWikiPreamble() + composed + checklistBlock + RU_TAIL,
    timeoutMs,
    EXECUTOR_MODEL_ID
  );
  heartbeatStopped = true;
  clearInterval(heartbeatInterval);

  const reply = (ok ? stdout : stderr || stdout).trim() || "(пустой ответ agent)";

  // Replace the ⏳ processing placeholder with the actual reply
  await prisma.chatMessage.update({
    where: { id: processingMsg.id },
    data: { content: reply },
  });

  await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });

  // Auto-update checklist: mark steps done based on [STEP_DONE: ...] markers in reply
  try {
    await applyStepDoneFromReply(prisma, sessionId, reply);
  } catch {
    // non-critical — ignore checklist errors
  }

  // Re-fetch messages to check rework count before launching auditor
  const freshMsgs = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const freshSess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { isStopped: true } });
  if (!freshSess?.isStopped && shouldRunAuditor(reply, freshMsgs)) {
    // Auditor will handle queue drain after its verdict
    await enqueueAuditorForReply(sessionId, workspacePath, reply, timeoutMs, notifyUserId);
    // Clear the lock — auditor re-launches executor if needed, which will drain the queue
    await prisma.chatSession.update({ where: { id: sessionId }, data: { processingMsgId: null } });
    return;
  }

  // No auditor — drain the queue: find next pending user message
  // Use the original processingMsgId (may differ from currentMsgId on rework path)
  const lockMsgId = currentMsgId || sess?.processingMsgId || null;
  const nextMsgId = await findNextQueuedMsgId(sessionId, lockMsgId);
  if (nextMsgId && !freshSess?.isStopped) {
    // Claim the next message atomically
    const claimed = await prisma.chatSession.updateMany({
      where: { id: sessionId, isStopped: false },
      data: { processingMsgId: nextMsgId },
    });
    if (claimed.count > 0) {
      // Spawn new runner for the next queued message
      const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-chat-runner.mjs");
      const child = spawn(
        process.execPath,
        [runnerPath, sessionId, workspacePath, `msg:${nextMsgId}`, String(timeoutMs), notifyUserId].filter(Boolean),
        { detached: true, stdio: "ignore" }
      );
      child.unref();
      return; // new runner owns the lock
    }
  }

  // No more queued messages — release the lock
  await prisma.chatSession.update({ where: { id: sessionId }, data: { processingMsgId: null } });

  if (notifyUserId) {
    const meta = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        backlogItemId: true,
        project: { select: { slug: true, name: true } },
        backlogItem: { select: { ticketKey: true, title: true } },
      },
    });
    if (meta?.backlogItemId && meta.project?.slug) {
      const ticketLabel = meta.backlogItem?.ticketKey?.trim() || meta.backlogItemId.slice(0, 8);
      const ticketTitle = meta.backlogItem?.title?.trim() || "";
      const projectName = meta.project.name?.trim() || meta.project.slug;
      await notifyPortalUser(prisma, notifyUserId, {
        kind: "backlog_chat_idle",
        title: `✅ ${projectName} · ${ticketLabel}: ответ готов`,
        body: ticketTitle
          ? `«${ticketTitle}» — агент ответил. Нажмите чтобы открыть чат.`
          : "Фоновый ответ в чате тикета готов. Нажмите чтобы открыть.",
        href: `/projects/${meta.project.slug}/backlog/${meta.backlogItemId}`,
      });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    try {
      const sessionId = process.argv[2];
      const notifyUserId = String(process.argv[6] || "").trim();
      if (sessionId) {
        // Try to replace the ⏳ processing message with the error
        const errContent = `Ошибка фонового агента: ${e instanceof Error ? e.message : String(e)}`;
        const stuck = await prisma.chatMessage.findFirst({
          where: { sessionId, role: "assistant", content: "⏳ Агент обрабатывает сообщение…" },
          orderBy: { createdAt: "desc" },
        });
        if (stuck) {
          await prisma.chatMessage.update({ where: { id: stuck.id }, data: { content: errContent } });
        } else {
          await prisma.chatMessage.create({
            data: { sessionId, role: "assistant", content: errContent },
          });
        }
        // Release the lock on error so queue can be drained
        await prisma.chatSession.update({ where: { id: sessionId }, data: { processingMsgId: null } }).catch(() => {});
        if (notifyUserId) {
          const meta = await prisma.chatSession.findUnique({
            where: { id: sessionId },
            select: {
              backlogItemId: true,
              project: { select: { slug: true, name: true } },
              backlogItem: { select: { ticketKey: true, title: true } },
            },
          });
          if (meta?.backlogItemId && meta.project?.slug) {
            const ticketLabel = meta.backlogItem?.ticketKey?.trim() || meta.backlogItemId.slice(0, 8);
            const projectName = meta.project.name?.trim() || meta.project.slug;
            await notifyPortalUser(prisma, notifyUserId, {
              kind: "backlog_chat_failed",
              title: `❌ ${projectName} · ${ticketLabel}: ошибка агента`,
              body: e instanceof Error ? e.message : String(e),
              href: `/projects/${meta.project.slug}/backlog/${meta.backlogItemId}`,
            });
          }
        }
      }
    } catch {
      // ignore
    } finally {
      await prisma.$disconnect();
    }
    process.exit(1);
  });

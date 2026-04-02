import { PrismaClient } from "@prisma/client";
import { runAgentPrompt } from "./lib/agent-cli.mjs";
import { shectoryWikiPreamble } from "./lib/shectory-wiki.mjs";
import { notifyPortalUser } from "./lib/portal-notify.mjs";

const prisma = new PrismaClient();

const EXECUTOR_MODEL_ID = (process.env.SHECTORY_EXECUTOR_AGENT_MODEL_ID || "claude-4.6-sonnet-medium").trim();

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
  "после чего добавь строку [***waiting for answer***].";

/** Сколько последних сообщений тянуть из БД (хвост переписки). */
const DB_TAIL = 420;
/** Максимум сообщений в промпт агента после склейки (не считая текущее user). */
const AGENT_WINDOW = 120;

function isProcessingAssistantMsg(m) {
  return m.role === "assistant" && m.content.trimStart().startsWith("⏳");
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

async function main() {
  const [sessionId, workspacePath, payloadArg, timeoutStr, notifyUserIdRaw] = process.argv.slice(2);
  if (!sessionId || !workspacePath || !payloadArg) {
    throw new Error("Usage: agent-chat-runner.mjs <sessionId> <workspacePath> <payload> [timeoutMs] [notifyUserId]");
  }
  const notifyUserId = String(notifyUserIdRaw || "").trim();
  const timeoutMs = Number(timeoutStr || process.env.AGENT_PROMPT_TIMEOUT_MS || "1800000") || 1_800_000;

  const sess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { isStopped: true } });
  if (sess?.isStopped) return;

  let prompt = "";
  const payload = String(payloadArg || "").trim();
  if (payload.startsWith("msg:")) {
    const msgId = payload.slice("msg:".length).trim();
    const m = await prisma.chatMessage.findFirst({
      where: { id: msgId, sessionId, role: "user" },
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
          `payload=${payload.slice(0, 200)}\n`,
      },
    });
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    return;
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

  const { ok, stdout, stderr } = await runAgentPrompt(
    workspacePath,
    shectoryWikiPreamble() + composed + RU_TAIL,
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

  if (notifyUserId) {
    const meta = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { backlogItemId: true, project: { select: { slug: true } } },
    });
    if (meta?.backlogItemId && meta.project?.slug) {
      await notifyPortalUser(prisma, notifyUserId, {
        kind: "backlog_chat_idle",
        title: "Тикет: агент в режиме ожидания",
        body: "Фоновый ответ в чате тикета готов. Можно вернуться к переписке.",
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
        if (notifyUserId) {
          const meta = await prisma.chatSession.findUnique({
            where: { id: sessionId },
            select: { backlogItemId: true, project: { select: { slug: true } } },
          });
          if (meta?.backlogItemId && meta.project?.slug) {
            await notifyPortalUser(prisma, notifyUserId, {
              kind: "backlog_chat_failed",
              title: "Тикет: ошибка фонового агента",
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

import { PrismaClient } from "@prisma/client";
import { runAgentPrompt } from "./lib/agent-cli.mjs";

const prisma = new PrismaClient();

const RU_TAIL =
  "\n\n━━ Язык ответа ━━\nОтвечай по-русски (кроме имён файлов, команд терминала, идентификаторов API и фрагментов кода). Не начинай ответ с английских вводных фраз.\n" +
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

async function main() {
  const [sessionId, workspacePath, promptB64, timeoutStr] = process.argv.slice(2);
  if (!sessionId || !workspacePath || !promptB64) {
    throw new Error("Usage: agent-chat-runner.mjs <sessionId> <workspacePath> <promptB64> [timeoutMs]");
  }
  const timeoutMs = Number(timeoutStr || process.env.AGENT_PROMPT_TIMEOUT_MS || "1800000") || 1_800_000;
  const prompt = Buffer.from(promptB64, "base64").toString("utf8");

  await prisma.chatMessage.create({
    data: { sessionId, role: "assistant", content: "⏳ Агент обрабатывает сообщение…" },
  });

  const tailDesc = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: DB_TAIL,
    select: { id: true, role: true, content: true },
  });
  let raw = tailDesc.reverse();

  const firstUserRow = await prisma.chatMessage.findFirst({
    where: { sessionId, role: "user" },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
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
      .map((m) => (m.role === "user" ? `Пользователь:\n${m.content}` : `Ассистент:\n${m.content}`))
      .join("\n\n---\n\n");
    if (historyText.length > 0) {
      composed = `${historyText}\n\n---\n\nНовое сообщение пользователя:\n${prompt}`;
    }
  }

  const { ok, stdout, stderr } = await runAgentPrompt(workspacePath, composed + RU_TAIL, timeoutMs);
  const reply = (ok ? stdout : stderr || stdout).trim() || "(пустой ответ agent)";

  await prisma.chatMessage.create({
    data: { sessionId, role: "assistant", content: reply },
  });

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
            content: `Ошибка фонового агента: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    } catch {
      // ignore
    } finally {
      await prisma.$disconnect();
    }
    process.exit(1);
  });

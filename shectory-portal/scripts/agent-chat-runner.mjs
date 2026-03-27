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

function isProcessingAssistantMsg(m) {
  return m.role === "assistant" && m.content.trimStart().startsWith("⏳");
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

  const raw = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const meaningful = raw.filter((m) => !isProcessingAssistantMsg(m));
  const last = meaningful[meaningful.length - 1];
  let composed = prompt;
  if (last?.role === "user") {
    const history = meaningful.slice(0, -1);
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

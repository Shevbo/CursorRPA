import { PrismaClient } from "@prisma/client";
import { runAgentPrompt } from "./lib/agent-cli.mjs";

const prisma = new PrismaClient();

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

  const { ok, stdout, stderr } = await runAgentPrompt(workspacePath, prompt, timeoutMs);
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

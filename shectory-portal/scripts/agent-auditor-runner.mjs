import { PrismaClient } from "@prisma/client";
import { runAgentPrompt } from "./lib/agent-cli.mjs";
import { shectoryWikiPreamble } from "./lib/shectory-wiki.mjs";

const prisma = new PrismaClient();

const AUDITOR_MODEL_ID = (process.env.SHECTORY_AUDITOR_AGENT_MODEL_ID || "gemini-3.1-pro").trim();

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function clip(s, max = 16000) {
  const t = s ?? "";
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…(truncated)…";
}

function pickLastNonAuditUserMessage(msgs) {
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
    if (c.startsWith("🕵️ Аудитор: Вердикт: На доработку")) {
      n += 1;
      continue;
    }
  }
  return n;
}

async function main() {
  const [sessionId, workspacePath, auditB64, timeoutStr] = process.argv.slice(2);
  if (!sessionId || !workspacePath || !auditB64) {
    throw new Error("Usage: agent-auditor-runner.mjs <sessionId> <workspacePath> <auditB64> [timeoutMs]");
  }
  const timeoutMs = Number(timeoutStr || process.env.AGENT_PROMPT_TIMEOUT_MS || "1800000") || 1_800_000;
  const payload = safeJsonParse(Buffer.from(auditB64, "base64").toString("utf8")) || {};

  const sess = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { isStopped: true } });
  if (sess?.isStopped) return;

  const tail = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const userTask = pickLastNonAuditUserMessage(tail);
  const trailingReworks = countTrailingAuditReworks(tail);
  const MAX_REWORKS = Number(process.env.AUDITOR_MAX_REWORKS || "5") || 5;

  const auditorPrompt =
    [
      "Ты — независимый агент-аудитор (критический проверяющий).",
      "Ниже — задача, которую пытался выполнить агент-исполнитель, и полный вывод его шага (команда + stdout/stderr).",
      "Твоя цель: оценить успешность шага относительно цели задачи и дать следующий контекст для исполнителя, если есть проблемы.",
      "",
      "Формат ответа — строго JSON (без markdown, без пояснений вокруг), UTF-8:",
      '{ "verdict": "success" | "rework", "summary": "коротко 1-3 предложения", "next_context": "если verdict=rework — конкретные инструкции/команды/проверки; иначе пустая строка" }',
      "",
      "Критерии:",
      "- verdict=success только если шаг действительно достиг цели / не оставил ошибок (даже если exit_code=0, но есть ошибки в stdout/stderr — это НЕ success).",
      "- При verdict=rework: next_context должен быть по существу (что исправить, где искать причину, какая следующая команда), а не общие слова.",
      "- Учитывай, что команды в этом чате выполняются через подтверждение пользователя: следующую команду проси оформлять как <<<SHELL_COMMAND>>>...<<</SHELL_COMMAND>>>.",
      `- Лимит автодоработок: максимум ${MAX_REWORKS} подряд. Если явно требуется вмешательство человека (секреты, доступы, неоднозначное решение) — выбирай verdict=rework и в next_context сформулируй конкретный вопрос пользователю.`,
      "",
      "ЗАДАЧА ПОЛЬЗОВАТЕЛЯ (контекст исполнителя):",
      userTask || "(не найдено — используй содержимое тикета/переписки по смыслу)",
      "",
      "ШАГ ИСПОЛНИТЕЛЯ:",
      `command: ${payload.command || ""}`,
      `exit_code: ${String(payload.exitCode)}`,
      "",
      payload.stdout ? `stdout:\n${clip(payload.stdout, 12000)}` : "stdout: (empty)",
      "",
      payload.stderr ? `stderr:\n${clip(payload.stderr, 12000)}` : "stderr: (empty)",
    ].join("\n");

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
          "🕵️ Аудитор: не смог распарсить JSON-вердикт. Считаю шаг неуспешным и прошу исполнителя уточнить следующий шаг.\n\n" +
          "Сформулируй следующую команду для исправления и выведи её через <<<SHELL_COMMAND>>>...<<</SHELL_COMMAND>>> + [***waiting for answer***].",
      },
    });
    return;
  }

  const summary = String(j.summary || "").trim();
  const nextCtx = String(j.next_context || "").trim();

  if (j.verdict === "success") {
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: `🕵️ Аудитор: Вердикт: Успех.\n${summary || ""}`.trim(),
      },
    });
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    return;
  }

  if (trailingReworks >= MAX_REWORKS) {
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content:
          `🕵️ Аудитор: Вердикт: На доработку (стоп-лимит). Уже было ${trailingReworks} попыток подряд — ` +
          `автоперезапуск остановлен. Нужны действия/решение человека.\n\n` +
          (summary ? `Кратко: ${summary}\n\n` : "") +
          (nextCtx ? `Что сделать дальше:\n${nextCtx}\n\n` : "") +
          "[***waiting for answer***]",
      },
    });
    await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    return;
  }

  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "assistant",
      content: `🕵️ Аудитор: Вердикт: На доработку.\n${summary || ""}`.trim(),
    },
  });

  const auditToExecutor =
    [
      "Аудитор: шаг НЕ успешен. Исправь по инструкциям ниже и продолжай до успеха.",
      "",
      nextCtx || "Сформулируй следующий конкретный шаг исправления и следующую команду.",
    ].join("\n");

  await prisma.chatMessage.create({
    data: { sessionId, role: "user", content: auditToExecutor },
  });

  const runnerPath = new URL("./agent-chat-runner.mjs", import.meta.url).pathname;
  const promptB64 = Buffer.from(auditToExecutor, "utf8").toString("base64");
  const child = (await import("node:child_process")).spawn(
    process.execPath,
    [runnerPath, sessionId, workspacePath, promptB64, String(timeoutMs)],
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
      }
    } catch {
      // ignore
    } finally {
      await prisma.$disconnect();
    }
    process.exit(1);
  });


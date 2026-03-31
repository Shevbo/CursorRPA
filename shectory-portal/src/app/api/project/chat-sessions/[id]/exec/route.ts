import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { looksLikeOutputFailure } from "@/lib/agent-chat-presence";
import { getAgentPromptTimeoutMs } from "@/lib/agent-timeout";

type Ctx = { params: { id: string } };

function clip(s: string, max = 20000): string {
  const t = s ?? "";
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n\n…(truncated)…";
}

export async function POST(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await prisma.chatSession.findUnique({
    where: { id: params.id },
    include: { project: { select: { workspacePath: true, slug: true } } },
  });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!session.project?.workspacePath) return NextResponse.json({ error: "workspacePath missing" }, { status: 500 });

  let body: { command?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) return NextResponse.json({ error: "command required" }, { status: 400 });

  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: "assistant",
      content: `### Запуск команды (после подтверждения)\n\n\`\`\`\n${command}\n\`\`\``,
    },
  });

  const timeoutMs = Number(process.env.AGENT_CMD_TIMEOUT_MS || "300000") || 300000;

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd: session.project.workspacePath, env: process.env });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 3000);
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: 127, stdout, stderr: String(e) });
    });
  });

  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: "assistant",
      content:
        `### Команда завершена\n\n` +
        `exit_code: ${String(result.code)}\n\n` +
        (result.stdout ? `stdout:\n${clip(result.stdout)}\n\n` : "") +
        (result.stderr ? `stderr:\n${clip(result.stderr)}\n\n` : ""),
    },
  });

  // Auditor: even when exit_code is 0, scan output for obvious failures.
  const outputFailed = looksLikeOutputFailure(result.stdout, result.stderr);
  const exitFailed = typeof result.code === "number" ? result.code !== 0 : result.code !== 0;
  if (exitFailed || outputFailed) {
    const why = exitFailed
      ? `exit_code=${String(result.code)}`
      : "вывод содержит явную ошибку при exit_code=0";
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content:
          `🕵️ Аудитор: обнаружена ошибка выполнения (${why}). ` +
          `Отправляю исполнителю контекст на исправление и добиваюсь успешного шага (exit_code: 0 без ошибок в выводе).`,
      },
    });

    const auditPrompt =
      [
        "Аудитор: предыдущая команда дала ошибку.",
        "Требование: продолжай исправлять до успеха (exit_code: 0 и нет явных ошибок в выводе).",
        "",
        "КОМАНДА:",
        command,
        "",
        `exit_code: ${String(result.code)}`,
        "",
        result.stdout ? `stdout:\n${clip(result.stdout, 12000)}` : "",
        result.stderr ? `stderr:\n${clip(result.stderr, 12000)}` : "",
        "",
        "Сформулируй следующий корректирующий шаг и выведи следующую команду через <<<SHELL_COMMAND>>>...<<</SHELL_COMMAND>>> + [***waiting for answer***].",
      ]
        .filter(Boolean)
        .join("\n");

    const userMsg = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: auditPrompt },
    });

    const runnerPath = path.join(process.cwd(), "scripts", "agent-chat-runner.mjs");
    const promptB64 = Buffer.from(auditPrompt, "utf8").toString("base64");
    const child = spawn(
      process.execPath,
      [runnerPath, session.id, session.project.workspacePath, promptB64, String(getAgentPromptTimeoutMs())],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
    // include userMsg in response for debugging if needed
    void userMsg;
  }

  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

  return NextResponse.json({
    ok: true,
    command,
    code: result.code,
    stdout: clip(result.stdout),
    stderr: clip(result.stderr),
  });
}


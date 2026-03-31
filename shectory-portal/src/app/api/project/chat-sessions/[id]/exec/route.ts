import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
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

  // LLM Auditor: always evaluate full output with an independent prompt.
  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: "assistant",
      content: "🕵️ Аудитор: проверяю успешность шага по полному выводу…",
    },
  });

  const auditorPath = path.join(process.cwd(), "scripts", "agent-auditor-runner.mjs");
  const auditPayload = {
    sessionId: session.id,
    command,
    exitCode: result.code,
    stdout: clip(result.stdout, 12000),
    stderr: clip(result.stderr, 12000),
  };
  const auditB64 = Buffer.from(JSON.stringify(auditPayload), "utf8").toString("base64");
  const auditChild = spawn(
    process.execPath,
    [auditorPath, session.id, session.project.workspacePath, auditB64, String(getAgentPromptTimeoutMs())],
    { detached: true, stdio: "ignore" }
  );
  auditChild.unref();

  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

  return NextResponse.json({
    ok: true,
    command,
    code: result.code,
    stdout: clip(result.stdout),
    stderr: clip(result.stderr),
  });
}


import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

function clip(s: string, max = 20000): string {
  const t = s ?? "";
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n\n…(truncated)…";
}

async function nextSeq(runId: string): Promise<number> {
  const last = await prisma.agentRunEvent.findFirst({
    where: { runId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (last?.seq ?? 0) + 1;
}

async function emit(runId: string, type: string, message = "", data?: unknown) {
  const seq = await nextSeq(runId);
  await prisma.agentRunEvent.create({ data: { runId, seq, type, message, data: data as any } });
  await prisma.agentRun.update({ where: { id: runId }, data: { lastHeartbeatAt: new Date() } });
}

export async function POST(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const run = await prisma.agentRun.findUnique({
    where: { id: params.id },
    include: { project: true },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!run.project?.workspacePath) return NextResponse.json({ error: "workspacePath missing" }, { status: 500 });

  let body: { command?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) return NextResponse.json({ error: "command required" }, { status: 400 });

  // Mark run waiting_user->running to reflect "your move done"
  if (run.status === "waiting_user") {
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: "running" } });
  }

  await emit(run.id, "cmd_approved", command, { command });
  await emit(run.id, "cmd_started", "Запуск команды", { command, cwd: run.project.workspacePath });

  const timeoutMs = Number(process.env.AGENT_CMD_TIMEOUT_MS || "300000") || 300000;

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd: run.project.workspacePath, env: process.env });
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

  const payload = {
    command,
    code: result.code,
    stdout: clip(result.stdout),
    stderr: clip(result.stderr),
  };

  await emit(run.id, "cmd_finished", "Команда завершилась", { command, code: result.code });
  await emit(run.id, "cmd_output", "stdout/stderr", payload);

  // Also write to chat if linked.
  if (run.sessionId) {
    await prisma.chatMessage.create({
      data: {
        sessionId: run.sessionId,
        role: "assistant",
        content:
          `### Выполнена команда (после подтверждения)\n\n` +
          `\`\`\`\n${command}\n\`\`\`\n\n` +
          `exit_code: ${String(result.code)}\n\n` +
          (payload.stdout ? `stdout:\n${payload.stdout}\n\n` : "") +
          (payload.stderr ? `stderr:\n${payload.stderr}\n\n` : ""),
      },
    });
    await prisma.chatSession.update({ where: { id: run.sessionId }, data: { updatedAt: new Date() } });
  }

  return NextResponse.json({ ok: true, ...payload });
}


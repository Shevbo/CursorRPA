import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { getAgentPromptTimeoutMs } from "@/lib/agent-timeout";
import { spawn } from "node:child_process";
import path from "node:path";

function redactSecrets(text: string): string {
  // Minimal redaction to avoid storing obvious passwords in chat history.
  return text.replace(/(sshpass\s+-p\s+)(\"[^\"]*\"|'[^']*'|\S+)/gi, "$1'***'");
}

export async function POST(req: Request) {
  if (!adminAuthOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { projectId?: string; projectSlug?: string; sessionId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { projectId, projectSlug, sessionId, message } = body;
  if ((!projectId && !projectSlug) || !sessionId || !message?.trim()) {
    return NextResponse.json({ error: "projectId|projectSlug, sessionId, message required" }, { status: 400 });
  }

  const project = projectId
    ? await prisma.project.findUnique({ where: { id: projectId } })
    : await prisma.project.findUnique({ where: { slug: String(projectSlug) } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, projectId: project.id },
  });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  if (session.isStopped) {
    return NextResponse.json({ error: "Session is stopped" }, { status: 409 });
  }

  const cleanMessage = redactSecrets(message.trim());
  const userMsg = await prisma.chatMessage.create({
    data: { sessionId, role: "user", content: cleanMessage },
  });

  const runnerPath = path.join(process.cwd(), "scripts", "agent-chat-runner.mjs");
  // Pass message id instead of full text: avoids argv length/E2BIG and encoding issues.
  const payload = `msg:${userMsg.id}`;
  const child = spawn(
    process.execPath,
    [runnerPath, sessionId, project.workspacePath, payload, String(getAgentPromptTimeoutMs())],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  return NextResponse.json(
    {
      ok: true,
      async: true,
      userMsg,
      sessionId,
      timeoutMs: getAgentPromptTimeoutMs(),
    },
    { status: 202 }
  );
}

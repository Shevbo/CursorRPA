import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { getAgentPromptTimeoutMs } from "@/lib/agent-timeout";
import { spawn } from "node:child_process";
import path from "node:path";

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

  const userMsg = await prisma.chatMessage.create({
    data: { sessionId, role: "user", content: message.trim() },
  });

  const ruTail =
    "\n\n━━ Язык ответа ━━\nОтвечай по-русски (кроме имён файлов, команд терминала, идентификаторов API и фрагментов кода). Не начинай ответ с английских вводных фраз.\n" +
    "━━ Ожидание ответа ━━\n" +
    "Если тебе нужно получить от человека ответ/уточнение (вопрос, выбор вариантов, согласование), в КОНЦЕ сообщения добавь ровно одну строку: [***waiting for answer***] и остановись (не продолжай решение до ответа пользователя).";
  const runnerPath = path.join(process.cwd(), "scripts", "agent-chat-runner.mjs");
  const promptB64 = Buffer.from(message.trim() + ruTail, "utf8").toString("base64");
  const child = spawn(
    process.execPath,
    [runnerPath, sessionId, project.workspacePath, promptB64, String(getAgentPromptTimeoutMs())],
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

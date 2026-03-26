import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { spawn } from "node:child_process";
import path from "node:path";

type Ctx = { params: { id: string } };

export async function POST(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { systemPrompt?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!systemPrompt) return NextResponse.json({ error: "systemPrompt required" }, { status: 400 });

  const item = await prisma.backlogItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      projectId: true,
      ticketKey: true,
      title: true,
      description: true,
      descriptionPrompt: true,
    },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const project = await prisma.project.findUnique({
    where: { id: item.projectId },
    select: { id: true, name: true, slug: true, workspacePath: true, aiContext: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const session = await prisma.chatSession.findFirst({
    where: { backlogItemId: item.id, projectId: project.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  const prompt = [
    systemPrompt,
    "",
    "ВАЖНО: ответ должен быть ТОЛЬКО текстом инженерного промпта на РУССКОМ языке.",
    "Запрещено писать связный текст на английском (ни одного абзаца целиком на English).",
    "Запрещено добавлять любые вступления, пояснения, разделители (---), заголовки, метаданные (Ticket/Project), блоки 'Now I have...' и т.п.",
    "Не используй Markdown-разметку (никаких #, ##, **, списков). Просто цельный текст промпта, который можно целиком вставить в Cursor Agent CLI.",
    "",
    "Данные задания:",
    `Project: ${project.name} (${project.slug})`,
    "",
    "Контекст проекта (aiContext):",
    project.aiContext?.trim() ? project.aiContext.trim() : "(пусто)",
    "",
    "Команды унифицированного деплоя/коммита (включи в промпт, если задача требует деплоя):",
    `- SSH: ssh shectory-work`,
    `- Унифицированно: /home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh ${project.slug} hoster`,
    item.ticketKey ? `Ticket: ${item.ticketKey}` : `TicketId: ${item.id}`,
    `Title: ${item.title}`,
    "",
    item.description ? `Описание:\n${item.description}` : "Описание: (пусто)",
    "",
    "Требования к результату:",
    "- Сформируй подробный промпт (на русском), который можно передать Cursor Agent CLI",
    "- Добавь структуру: Цель, Контекст, Ограничения, План, Acceptance Criteria, Test Plan",
    "- Если есть неопределённости, добавь вопросы в конце",
  ].join("\n");

  const run = await prisma.agentRun.create({
    data: {
      projectId: project.id,
      backlogItemId: item.id,
      sessionId: session?.id ?? null,
      kind: "engineering_prompt",
      status: "queued",
      title: item.ticketKey ? `Инженерный промпт ${item.ticketKey}` : `Инженерный промпт ${item.id.slice(0, 8)}`,
      prompt,
      steps: {
        create: [{ index: 1, title: "Сгенерировать инженерный промпт" }],
      },
    },
    include: { steps: { orderBy: { index: "asc" } } },
  });

  const runnerPath = path.join(process.cwd(), "scripts", "agent-runner.mjs");
  const child = spawn(process.execPath, [runnerPath, run.id], { detached: true, stdio: "ignore" });
  child.unref();

  return NextResponse.json({ ok: true, async: true, runId: run.id, run }, { status: 202 });
}


import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { spawn } from "node:child_process";
import path from "node:path";

type Ctx = { params: { id: string } };

export async function POST(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";

  const item = await prisma.backlogItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      projectId: true,
      status: true,
      isPaused: true,
      ticketKey: true,
      sprintId: true,
      title: true,
      description: true,
      descriptionPrompt: true,
    },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (item.sprintId) {
    return NextResponse.json(
      { error: "Ticket is in a sprint; work happens at sprint level", sprintId: item.sprintId },
      { status: 409 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: item.projectId },
    select: { id: true, workspacePath: true, name: true, slug: true, aiContext: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { session, createdNow } = await prisma.$transaction(async (tx) => {
    const existing = await tx.chatSession.findFirst({
      where: { projectId: item.projectId, backlogItemId: item.id },
      orderBy: { updatedAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (existing) return { session: existing, createdNow: false };

    const title = item.ticketKey ? `Ticket ${item.ticketKey}` : `Ticket ${item.id.slice(0, 8)}`;
    const created = await tx.chatSession.create({
      data: { projectId: item.projectId, backlogItemId: item.id, title },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (item.status === "new" && !item.isPaused) {
      await tx.backlogItem.update({ where: { id: item.id }, data: { status: "in_progress", statusChangedAt: new Date() } });
    }

    return { session: created, createdNow: true };
  });

  // If this is a new session, start it asynchronously: immediately return session,
  // then send ticket context to agent and append assistant reply into the same session.
  if (createdNow || force) {
    const context = [
      "Задача из бэклога (контекст тикета):",
      `Проект: ${project.name} (${project.slug})`,
      "",
      "Контекст проекта (aiContext):",
      project.aiContext?.trim() ? project.aiContext.trim() : "(пусто)",
      "",
      "Команды унифицированного деплоя/коммита (если понадобится деплой):",
      `- SSH: ssh shectory-work`,
      `- Унифицированно: /home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh ${project.slug} hoster`,
      "",
      item.ticketKey ? `Тикет: ${item.ticketKey}` : `Id тикета: ${item.id}`,
      `Заголовок: ${item.title}`,
      "",
      item.description ? `Описание:\n${item.description}` : "Описание: (пусто)",
      "",
      item.descriptionPrompt?.trim() ? `Промпт / ТЗ:\n${item.descriptionPrompt.trim()}` : "Промпт / ТЗ: (пусто)",
      "",
      "Нужно выполнить задачу по тикету. Если данных не хватает — задай вопросы в ответе и предложи план.",
    ].join("\n");

    const userMsg = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: context },
    });

    const run = await prisma.agentRun.create({
      data: {
        projectId: project.id,
        backlogItemId: item.id,
        sessionId: session.id,
        kind: "backlog_ticket_start",
        status: "queued",
        title: item.ticketKey ? `Запуск тикета ${item.ticketKey}` : `Запуск тикета ${item.id.slice(0, 8)}`,
        prompt: context,
        userMessageId: userMsg.id,
        steps: {
          create: [
            { index: 1, title: "Шаг 1/5 — анализ и 3 подзадачи" },
            { index: 2, title: "Шаг 2/5 — подзадача 1/3" },
            { index: 3, title: "Шаг 3/5 — подзадача 2/3" },
            { index: 4, title: "Шаг 4/5 — подзадача 3/3" },
            { index: 5, title: "Шаг 5/5 — итог и следующие шаги" },
          ],
        },
      },
      include: { steps: { orderBy: { index: "asc" } } },
    });

    // Run the agent-runner in a detached process; it writes progress to AgentRunEvent.
    const runnerPath = path.join(process.cwd(), "scripts", "agent-runner.mjs");
    const child = spawn(process.execPath, [runnerPath, run.id], { detached: true, stdio: "ignore" });
    child.unref();

    return NextResponse.json(
      {
        ok: true,
        session,
        startedAsync: true,
        runId: run.id,
        run,
        force,
        startUserMsgId: userMsg.id,
        startedAt: new Date().toISOString(),
      },
      { status: 202 }
    );
  }

  return NextResponse.json({ ok: true, session });
}


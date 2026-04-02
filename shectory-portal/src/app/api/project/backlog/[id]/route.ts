import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { adminAuthOk } from "@/lib/admin-auth";
import {
  BACKLOG_ITEM_STATUSES,
  BACKLOG_SPRINT_STATUSES,
  isBacklogItemStatus,
  isBacklogSprintStatus,
} from "@/lib/backlog-constants";
import { prisma } from "@/lib/prisma";

type Ctx = { params: { id: string } };

type PatchBody = {
  title?: string;
  description?: string | null;
  descriptionPrompt?: string;
  status?: string;
  priority?: number;
  orderNum?: number | null;
  sprintNumber?: number;
  sprintStatus?: string;
  sprintId?: string | null;
  taskType?: string | null;
  modules?: string | null;
  components?: string | null;
  complexity?: number | null;
  docLink?: string | null;
  testOrderOrLink?: string | null;
  isPaused?: boolean;
};

export async function GET(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const item = await prisma.backlogItem.findUnique({
    where: { id: params.id },
    include: {
      sprint: true,
      chats: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 200,
          },
        },
      },
    },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rawSession = item.chats[0] ?? null;
  const session = rawSession
    ? {
        ...rawSession,
        messages: [...rawSession.messages].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        ),
      }
    : null;

  const latestAgentRun = await prisma.agentRun.findFirst({
    where: { backlogItemId: params.id, kind: "backlog_ticket_start" },
    orderBy: { createdAt: "desc" },
    include: { steps: { orderBy: { index: "asc" } } },
  });

  return NextResponse.json({ item, session, latestAgentRun });
}

export async function PATCH(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.backlogItem.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.title !== undefined && !body.title.trim()) {
    return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
  }

  if (body.status !== undefined && body.status !== null && !isBacklogItemStatus(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${BACKLOG_ITEM_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }
  if (
    body.sprintStatus !== undefined &&
    body.sprintStatus !== null &&
    !isBacklogSprintStatus(body.sprintStatus)
  ) {
    return NextResponse.json(
      { error: `sprintStatus must be one of: ${BACKLOG_SPRINT_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const data: Prisma.BacklogItemUpdateInput = {};
  if (body.title !== undefined) data.title = body.title!.trim().slice(0, 200);
  if (body.description !== undefined) data.description = body.description;
  if (body.descriptionPrompt !== undefined) data.descriptionPrompt = body.descriptionPrompt.trim();
  if (body.status !== undefined) data.status = body.status;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.orderNum !== undefined) data.orderNum = body.orderNum;
  if (body.sprintNumber !== undefined) data.sprintNumber = body.sprintNumber;
  if (body.sprintStatus !== undefined) data.sprintStatus = body.sprintStatus;
  if (body.sprintId !== undefined) data.sprint = body.sprintId ? { connect: { id: body.sprintId } } : { disconnect: true };
  if (body.taskType !== undefined) data.taskType = body.taskType;
  if (body.modules !== undefined) data.modules = body.modules;
  if (body.components !== undefined) data.components = body.components;
  if (body.complexity !== undefined) data.complexity = body.complexity;
  if (body.docLink !== undefined) data.docLink = body.docLink;
  if (body.testOrderOrLink !== undefined) data.testOrderOrLink = body.testOrderOrLink;
  if (body.isPaused !== undefined) {
    data.isPaused = body.isPaused;
    data.pausedAt = body.isPaused ? new Date() : null;
  }

  if (body.status !== undefined && body.status !== existing.status) {
    data.statusChangedAt = new Date();
  }

  const updated = await prisma.backlogItem.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await prisma.backlogItem.delete({ where: { id: params.id } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

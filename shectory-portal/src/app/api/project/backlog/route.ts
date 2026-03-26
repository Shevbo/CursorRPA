import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { adminAuthOk } from "@/lib/admin-auth";
import {
  BACKLOG_ITEM_STATUSES,
  BACKLOG_SPRINT_STATUSES,
  isBacklogItemStatus,
  isBacklogSprintStatus,
} from "@/lib/backlog-constants";
import { prisma } from "@/lib/prisma";

const SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "priority",
  "orderNum",
  "sprintNumber",
  "statusChangedAt",
]);

function normalizeTicketPrefix(raw: string): string {
  const p = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 5);
  return p;
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const status = searchParams.get("status");
  const sprintNumber = searchParams.get("sprintNumber");
  const taskType = searchParams.get("taskType");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const sortBy = searchParams.get("sortBy") || "createdAt";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";

  const where: Prisma.BacklogItemWhereInput = { projectId };
  if (status && isBacklogItemStatus(status)) where.status = status;
  if (taskType?.trim()) where.taskType = taskType.trim();
  if (sprintNumber !== null && sprintNumber !== "") {
    const n = parseInt(sprintNumber, 10);
    if (!Number.isNaN(n)) where.sprintNumber = n;
  }

  const orderField = SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
  const orderBy: Prisma.BacklogItemOrderByWithRelationInput = {
    [orderField]: sortDir,
  };

  const [items, total] = await Promise.all([
    prisma.backlogItem.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.backlogItem.count({ where }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    sortBy: orderField,
    sortDir,
  });
}

type CreateBody = {
  projectId?: string;
  title?: string;
  description?: string;
  descriptionPrompt?: string;
  status?: string;
  priority?: number;
  orderNum?: number | null;
  sprintNumber?: number;
  sprintStatus?: string;
  taskType?: string;
  modules?: string;
  components?: string;
  complexity?: number | null;
  docLink?: string;
  testOrderOrLink?: string;
};

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { projectId, title } = body;
  if (!projectId || !title?.trim()) {
    return NextResponse.json({ error: "projectId and title required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, ticketPrefix: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const prefix = project.ticketPrefix ? normalizeTicketPrefix(project.ticketPrefix) : "";
  if (!prefix) {
    return NextResponse.json(
      { error: "Project ticketPrefix is required before creating the first ticket", code: "ticket_prefix_required" },
      { status: 409 }
    );
  }

  const st = body.status?.trim();
  if (st && !isBacklogItemStatus(st)) {
    return NextResponse.json(
      { error: `status must be one of: ${BACKLOG_ITEM_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }
  const sp = body.sprintStatus?.trim();
  if (sp && !isBacklogSprintStatus(sp)) {
    return NextResponse.json(
      { error: `sprintStatus must be one of: ${BACKLOG_SPRINT_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.projectTicketCounter.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, nextSeq: 1 },
      update: {},
    });

    const counter = await tx.projectTicketCounter.update({
      where: { projectId: project.id },
      data: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });

    const seq = counter.nextSeq - 1;
    const ticketKey = `${prefix}-${seq}`;

    return await tx.backlogItem.create({
      data: {
        projectId,
        ticketKey,
        ticketSeq: seq,
        title: title.trim(),
        description: body.description?.trim() || null,
        descriptionPrompt: body.descriptionPrompt?.trim() ?? "",
        status: st && isBacklogItemStatus(st) ? st : "new",
        priority: typeof body.priority === "number" ? body.priority : 3,
        orderNum: body.orderNum ?? undefined,
        sprintNumber: typeof body.sprintNumber === "number" ? body.sprintNumber : 0,
        sprintStatus: sp && isBacklogSprintStatus(sp) ? sp : "forming",
        taskType: body.taskType?.trim() || null,
        modules: body.modules?.trim() || null,
        components: body.components?.trim() || null,
        complexity: body.complexity ?? undefined,
        docLink: body.docLink?.trim() || null,
        testOrderOrLink: body.testOrderOrLink?.trim() || null,
        statusChangedAt: new Date(),
      },
    });
  });
  return NextResponse.json({ item: created });
}

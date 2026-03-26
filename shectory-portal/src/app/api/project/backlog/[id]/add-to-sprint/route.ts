import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { isBacklogSprintStatus } from "@/lib/backlog-constants";

type Ctx = { params: { id: string } };

export async function POST(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sprintNumber?: unknown; sprintStatus?: unknown; sprintTitle?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sprintNumber = typeof body.sprintNumber === "number" ? body.sprintNumber : parseInt(String(body.sprintNumber ?? ""), 10);
  if (!Number.isFinite(sprintNumber) || sprintNumber <= 0) {
    return NextResponse.json({ error: "sprintNumber must be a positive number" }, { status: 400 });
  }

  const sprintStatusRaw = typeof body.sprintStatus === "string" ? body.sprintStatus.trim() : "";
  const sprintStatus = sprintStatusRaw && isBacklogSprintStatus(sprintStatusRaw) ? sprintStatusRaw : "forming";
  const sprintTitle = typeof body.sprintTitle === "string" ? body.sprintTitle.trim().slice(0, 120) : "";

  const item = await prisma.backlogItem.findUnique({ where: { id: params.id }, select: { id: true, projectId: true } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    const sprint = await tx.sprint.upsert({
      where: { projectId_number: { projectId: item.projectId, number: sprintNumber } },
      create: { projectId: item.projectId, number: sprintNumber, status: sprintStatus, title: sprintTitle },
      update: { status: sprintStatus, ...(sprintTitle ? { title: sprintTitle } : {}) },
    });

    const updated = await tx.backlogItem.update({
      where: { id: item.id },
      data: {
        sprint: { connect: { id: sprint.id } },
        sprintNumber,
        sprintStatus,
      },
      include: { sprint: true },
    });

    return { sprint, item: updated };
  });

  return NextResponse.json({ ok: true, ...result });
}


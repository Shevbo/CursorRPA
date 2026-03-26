import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { isBacklogSprintStatus } from "@/lib/backlog-constants";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId")?.trim();
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const status = searchParams.get("status")?.trim();
  const where = { projectId, ...(status && isBacklogSprintStatus(status) ? { status } : {}) };

  const sprints = await prisma.sprint.findMany({
    where,
    orderBy: [{ number: "desc" }],
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json({ ok: true, sprints });
}

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { projectId?: unknown; number?: unknown; status?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const number = typeof body.number === "number" ? body.number : parseInt(String(body.number ?? ""), 10);
  if (!projectId || !Number.isFinite(number) || number <= 0) {
    return NextResponse.json({ error: "projectId and positive number required" }, { status: 400 });
  }

  const statusRaw = typeof body.status === "string" ? body.status.trim() : "";
  const status = statusRaw && isBacklogSprintStatus(statusRaw) ? statusRaw : "forming";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";

  const sprint = await prisma.sprint.upsert({
    where: { projectId_number: { projectId, number } },
    create: { projectId, number, status, title },
    update: { status, ...(title ? { title } : {}) },
  });

  return NextResponse.json({ ok: true, sprint });
}


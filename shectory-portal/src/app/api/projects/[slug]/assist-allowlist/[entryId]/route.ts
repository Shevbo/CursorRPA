import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { normalizeTelegramUserId } from "@/lib/assist-allowlist";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { slug: string; entryId: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug, entryId } = params;

  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const existing = await prisma.assistBotAllowlistEntry.findFirst({
    where: { id: entryId, projectId: project.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { enabled?: boolean; note?: string; telegramUserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: { enabled?: boolean; note?: string | null; telegramUserId?: string } = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (body.note !== undefined) data.note = body.note?.trim() || null;
  if (body.telegramUserId !== undefined) {
    const tid = normalizeTelegramUserId(String(body.telegramUserId));
    if (!tid) {
      return NextResponse.json({ error: "telegramUserId must be numeric" }, { status: 400 });
    }
    data.telegramUserId = tid;
  }

  try {
    const row = await prisma.assistBotAllowlistEntry.update({
      where: { id: entryId },
      data,
    });
    return NextResponse.json({
      entry: {
        id: row.id,
        telegramUserId: row.telegramUserId,
        note: row.note,
        enabled: row.enabled,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "Такой Telegram user id уже есть" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { slug: string; entryId: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug, entryId } = params;

  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const res = await prisma.assistBotAllowlistEntry.deleteMany({
    where: { id: entryId, projectId: project.id },
  });
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

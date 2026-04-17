import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { normalizeTelegramUserId } from "@/lib/assist-allowlist";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = params.slug;
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const entries = await prisma.assistBotAllowlistEntry.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    project: { id: project.id, slug, name: project.name },
    entries: entries.map((e) => ({
      id: e.id,
      telegramUserId: e.telegramUserId,
      note: e.note,
      enabled: e.enabled,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
    hint:
      "Пока нет ни одной включённой записи — бот принимает сообщения от любых Telegram-пользователей. После добавления хотя бы одной включённой записи доступ только у перечисленных numeric user id.",
  });
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = params.slug;
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: { telegramUserId?: string; note?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tid = normalizeTelegramUserId(String(body.telegramUserId ?? ""));
  if (!tid) {
    return NextResponse.json(
      { error: "telegramUserId must be a numeric Telegram user id (digits only)" },
      { status: 400 },
    );
  }

  try {
    const row = await prisma.assistBotAllowlistEntry.create({
      data: {
        projectId: project.id,
        telegramUserId: tid,
        note: body.note?.trim() || null,
        enabled: body.enabled !== false,
      },
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
    const msg = e instanceof Error ? e.message : "create failed";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "Этот Telegram user id уже есть в списке" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

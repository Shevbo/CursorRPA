import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { portalUserIdFromRequest } from "@/lib/portal-auth";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await portalUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "40", 10) || 40));

  const items = await prisma.portalNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      href: true,
      readAt: true,
      createdAt: true,
    },
  });
  const unread = await prisma.portalNotification.count({ where: { userId, readAt: null } });
  return NextResponse.json({ ok: true, items, unread });
}

export async function PATCH(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await portalUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { markRead?: boolean; ids?: string[]; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const now = new Date();
  if (body.markRead && body.all) {
    await prisma.portalNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
    return NextResponse.json({ ok: true });
  }
  if (body.markRead && body.ids?.length) {
    await prisma.portalNotification.updateMany({
      where: { userId, id: { in: body.ids } },
      data: { readAt: now },
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Нужны markRead и all или ids" }, { status: 400 });
}

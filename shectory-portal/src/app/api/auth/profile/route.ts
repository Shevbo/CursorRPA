import { NextResponse } from "next/server";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";
import { prisma } from "@/lib/prisma";

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

export async function GET(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const user = await prisma.portalUser.findUnique({
    where: { email: s.email },
    include: { profile: true },
  });
  if (!user) return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });

  // Portal-wide stats (no per-user attribution yet).
  const [projectsCount, messagesCount, lastMsg, recentSessions] = await Promise.all([
    prisma.project.count(),
    prisma.chatMessage.count(),
    prisma.chatMessage.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.chatSession.findMany({
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        project: { select: { slug: true, name: true } },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    user: {
      email: user.email,
      role: user.role,
      fullName: user.profile?.fullName ?? "",
      phone: user.profile?.phone ?? "",
      avatarUrl: user.profile?.avatarUrl ?? "",
    },
    stats: {
      projectsCount,
      messagesCount,
      lastActivityAt: lastMsg?.createdAt ?? null,
      rating: null,
    },
    history: recentSessions.map((s) => ({
      type: "chat_session",
      at: s.updatedAt,
      label: `${s.project.slug}: ${s.title}`,
      href: `/projects/${encodeURIComponent(s.project.slug)}`,
    })),
  });
}

export async function PATCH(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const user = await prisma.portalUser.findUnique({ where: { email: s.email }, select: { id: true, email: true, role: true } });
  if (!user) return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });

  let body: { fullName?: unknown; phone?: unknown; avatarUrl?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const fullName = norm(body.fullName);
  const phone = norm(body.phone);
  const avatarUrl = norm(body.avatarUrl);

  const profile = await prisma.portalUserProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, fullName, phone, avatarUrl },
    update: { fullName, phone, avatarUrl },
  });

  return NextResponse.json({
    ok: true,
    user: { email: user.email, role: user.role, fullName: profile.fullName, phone: profile.phone, avatarUrl: profile.avatarUrl },
  });
}


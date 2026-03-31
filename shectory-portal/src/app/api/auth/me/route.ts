import { NextResponse } from "next/server";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, user: null }, { status: 401 });
  const user = await prisma.portalUser.findUnique({
    where: { email: s.email },
    include: { profile: true },
  });
  return NextResponse.json({
    ok: true,
    user: {
      email: s.email,
      role: s.role,
      fullName: user?.profile?.fullName ?? "",
      phone: user?.profile?.phone ?? "",
      avatarUrl: user?.profile?.avatarUrl ?? "",
    },
  });
}


import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.portalUser.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      emailVerifiedAt: true,
      profile: { select: { fullName: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
      fullName: u.profile?.fullName || "",
    })),
  });
}

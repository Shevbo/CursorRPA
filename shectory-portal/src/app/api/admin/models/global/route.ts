import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const models = await prisma.projectModel.findMany({
    include: {
      project: { select: { slug: true, name: true } },
      provider: { select: { id: true, name: true, label: true, icon: true } },
    },
    orderBy: [{ providerId: "asc" }, { weight: "desc" }, { label: "asc" }],
  });

  return NextResponse.json({ ok: true, models });
}

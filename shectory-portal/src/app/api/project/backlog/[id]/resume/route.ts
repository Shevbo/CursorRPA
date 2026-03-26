import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

type Ctx = { params: { id: string } };

export async function POST(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const updated = await prisma.backlogItem.update({
    where: { id: params.id },
    data: { isPaused: false, pausedAt: null },
  });
  return NextResponse.json({ ok: true, item: updated });
}


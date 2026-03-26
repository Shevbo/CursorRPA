import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

type Ctx = { params: { id: string } };

export async function GET(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await prisma.chatSession.findUnique({
    where: { id: params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, session });
}


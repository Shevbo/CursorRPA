import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") || "300") || 300;
  const limit = Math.min(500, Math.max(1, rawLimit));

  const run = await prisma.agentRun.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tail = await prisma.agentRunEvent.findMany({
    where: { runId: params.id },
    orderBy: { seq: "desc" },
    take: limit,
    select: { seq: true, type: true, message: true, data: true, createdAt: true },
  });
  const events = [...tail].reverse();

  return NextResponse.json({ events });
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

type Ctx = { params: { id: string } };

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 300;

export async function GET(req: NextRequest, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await prisma.chatSession.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      projectId: true,
      title: true,
      backlogItemId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT)
  );
  const beforeRaw = url.searchParams.get("before")?.trim();

  let messagesAsc: Awaited<ReturnType<typeof prisma.chatMessage.findMany>>;
  let hasMoreOlder: boolean;

  if (!beforeRaw) {
    const batch = await prisma.chatMessage.findMany({
      where: { sessionId: params.id },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });
    hasMoreOlder = batch.length > limit;
    const trimmed = hasMoreOlder ? batch.slice(0, limit) : batch;
    messagesAsc = trimmed.reverse();
  } else {
    const beforeDate = new Date(beforeRaw);
    if (Number.isNaN(beforeDate.getTime())) {
      return NextResponse.json({ error: "Invalid before (expected ISO date)" }, { status: 400 });
    }
    const batch = await prisma.chatMessage.findMany({
      where: { sessionId: params.id, createdAt: { lt: beforeDate } },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });
    hasMoreOlder = batch.length > limit;
    const trimmed = hasMoreOlder ? batch.slice(0, limit) : batch;
    messagesAsc = trimmed.reverse();
  }

  const oldestLoadedCreatedAt = messagesAsc[0]?.createdAt?.toISOString() ?? null;

  return NextResponse.json({
    ok: true,
    session: { ...session, messages: messagesAsc },
    hasMoreOlder,
    oldestLoadedCreatedAt,
  });
}

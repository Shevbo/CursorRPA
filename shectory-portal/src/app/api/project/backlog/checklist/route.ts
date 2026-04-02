/**
 * Checklist API for backlog ticket items.
 *
 * GET  /api/project/backlog/checklist?itemId=...         — list check items
 * POST /api/project/backlog/checklist                    — create / bulk-create / extract from prompt
 * PATCH /api/project/backlog/checklist                   — update item (toggle done, edit text, reorder)
 * DELETE /api/project/backlog/checklist?id=...           — delete one item
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const itemId = req.nextUrl.searchParams.get("itemId")?.trim();
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const items = await prisma.backlogCheckItem.findMany({
    where: { backlogItemId: itemId },
    orderBy: [{ orderNum: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    itemId?: string;
    text?: string;
    /** Bulk: array of texts to add at once */
    texts?: string[];
    orderNum?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const itemId = body.itemId?.trim();
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  // Verify backlog item exists
  const exists = await prisma.backlogItem.findUnique({ where: { id: itemId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "BacklogItem not found" }, { status: 404 });

  // Get current max orderNum
  const maxRow = await prisma.backlogCheckItem.findFirst({
    where: { backlogItemId: itemId },
    orderBy: { orderNum: "desc" },
    select: { orderNum: true },
  });
  const baseOrder = (maxRow?.orderNum ?? -1) + 1;

  // Bulk create
  if (Array.isArray(body.texts) && body.texts.length > 0) {
    const texts = body.texts.map((t) => String(t).trim()).filter(Boolean).slice(0, 100);
    const data = texts.map((text, i) => ({
      backlogItemId: itemId,
      text,
      orderNum: baseOrder + i,
    }));
    await prisma.backlogCheckItem.createMany({ data });
    const items = await prisma.backlogCheckItem.findMany({
      where: { backlogItemId: itemId },
      orderBy: [{ orderNum: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ ok: true, items });
  }

  // Single create
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const item = await prisma.backlogCheckItem.create({
    data: {
      backlogItemId: itemId,
      text,
      orderNum: body.orderNum ?? baseOrder,
    },
  });
  return NextResponse.json({ ok: true, item });
}

export async function PATCH(req: NextRequest) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    id?: string;
    done?: boolean;
    text?: string;
    orderNum?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.done === "boolean") {
    data.done = body.done;
    data.doneAt = body.done ? new Date() : null;
  }
  if (typeof body.text === "string" && body.text.trim()) {
    data.text = body.text.trim();
  }
  if (typeof body.orderNum === "number") {
    data.orderNum = body.orderNum;
  }

  const item = await prisma.backlogCheckItem.update({ where: { id }, data });
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: NextRequest) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.backlogCheckItem.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}

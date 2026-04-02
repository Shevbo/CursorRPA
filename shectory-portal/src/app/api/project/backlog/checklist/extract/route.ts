/**
 * POST /api/project/backlog/checklist/extract
 *
 * Извлекает шаги/пункты из текста промпта тикета и создаёт их как чеклист.
 * Парсинг: нумерованные шаги (Шаг N., Step N., N.), маркированные списки.
 * Если шаги уже есть — добавляет только новые (по тексту).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

/** Извлечь пункты из текста промпта. */
function extractSteps(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const steps: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Нумерованные шаги: "Шаг 1.", "Шаг 1:", "Step 1.", "1.", "1)"
    const numbered = line.match(/^(?:шаг\s+)?(\d+)[.)]\s+(.+)/i);
    if (numbered) {
      const text = numbered[2]?.trim();
      if (text && text.length > 3) steps.push(text);
      continue;
    }

    // Маркированные: "- текст", "* текст", "• текст"
    const bulleted = line.match(/^[-*•]\s+(.+)/);
    if (bulleted) {
      const text = bulleted[1]?.trim();
      if (text && text.length > 3) steps.push(text);
      continue;
    }
  }

  // Дедупликация
  const seen = new Set<string>();
  return steps.filter((s) => {
    const k = s.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function POST(req: NextRequest) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { itemId?: string; replaceExisting?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const itemId = body.itemId?.trim();
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const backlogItem = await prisma.backlogItem.findUnique({
    where: { id: itemId },
    select: { id: true, descriptionPrompt: true, description: true },
  });
  if (!backlogItem) return NextResponse.json({ error: "BacklogItem not found" }, { status: 404 });

  const sourceText = [backlogItem.descriptionPrompt, backlogItem.description]
    .filter(Boolean)
    .join("\n\n");

  if (!sourceText.trim()) {
    return NextResponse.json({ ok: true, items: [], extracted: 0, message: "Нет текста для извлечения" });
  }

  const extracted = extractSteps(sourceText);
  if (extracted.length === 0) {
    return NextResponse.json({ ok: true, items: [], extracted: 0, message: "Шаги не найдены в промпте" });
  }

  if (body.replaceExisting) {
    await prisma.backlogCheckItem.deleteMany({ where: { backlogItemId: itemId } });
  }

  // Get existing texts to avoid duplicates
  const existing = await prisma.backlogCheckItem.findMany({
    where: { backlogItemId: itemId },
    select: { text: true, orderNum: true },
    orderBy: { orderNum: "desc" },
  });
  const existingTexts = new Set(existing.map((e) => e.text.toLowerCase().slice(0, 80)));
  const baseOrder = (existing[0]?.orderNum ?? -1) + 1;

  const toCreate = extracted
    .filter((t) => !existingTexts.has(t.toLowerCase().slice(0, 80)))
    .slice(0, 100);

  if (toCreate.length > 0) {
    await prisma.backlogCheckItem.createMany({
      data: toCreate.map((text, i) => ({
        backlogItemId: itemId,
        text,
        orderNum: baseOrder + i,
      })),
    });
  }

  const items = await prisma.backlogCheckItem.findMany({
    where: { backlogItemId: itemId },
    orderBy: [{ orderNum: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ ok: true, items, extracted: toCreate.length });
}

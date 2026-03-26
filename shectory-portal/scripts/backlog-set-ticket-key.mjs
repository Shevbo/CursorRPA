#!/usr/bin/env node
/**
 * Назначить тикету ключ (например PH-1) по префиксу id.
 * Запуск из каталога shectory-portal: node scripts/backlog-set-ticket-key.mjs [idPrefix] [ticketKey] [seq]
 * Пример: node scripts/backlog-set-ticket-key.mjs cmn6504o PH-1 1
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const idPrefix = process.argv[2] || "cmn6504o";
  const ticketKey = (process.argv[3] || "PH-1").toUpperCase();
  const seq = parseInt(process.argv[4] || "1", 10);

  const items = await prisma.backlogItem.findMany({
    where: { id: { startsWith: idPrefix } },
    select: { id: true, projectId: true, ticketKey: true },
    orderBy: { createdAt: "asc" },
  });
  if (items.length === 0) {
    console.error("Нет тикета с id, начинающимся на:", idPrefix);
    process.exit(1);
  }
  if (items.length > 1) {
    console.warn("Несколько совпадений; обновляется первый:", items[0].id);
  }
  const item = items[0];

  const taken = await prisma.backlogItem.findFirst({
    where: { ticketKey, NOT: { id: item.id } },
    select: { id: true },
  });
  if (taken) {
    console.error("Ключ уже занят другим тикетом:", taken.id);
    process.exit(1);
  }

  await prisma.backlogItem.update({
    where: { id: item.id },
    data: { ticketKey, ticketSeq: seq },
  });

  const cur = await prisma.projectTicketCounter.findUnique({ where: { projectId: item.projectId } });
  const nextSeq = Math.max(cur?.nextSeq ?? 1, seq + 1);
  await prisma.projectTicketCounter.upsert({
    where: { projectId: item.projectId },
    create: { projectId: item.projectId, nextSeq },
    update: { nextSeq },
  });

  console.log("OK:", item.id, "→", ticketKey, "nextSeq для проекта:", nextSeq);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });

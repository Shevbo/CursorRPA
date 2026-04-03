import { prisma } from "@/lib/prisma";

const CATEGORY_NAME = "Площадки";
const PI_LABEL = "Pi";
const PI_VALUE =
  "Shevbo-Pi — Raspberry Pi (LAN, Tailscale); пользователь shevbo; syslog-srv и PingMaster слушают :4444 / :4555 на Pi. Публичный HTTPS для людей — https://syslog.shectory.ru и https://pingmaster.shectory.ru (nginx на VDS → upstream на Pi).";

/** Идемпотентно добавляет площадку Pi, если каталог «Площадки» есть, а строки Pi/Shevbo-Pi ещё нет (без полного db:seed). */
export async function ensureShevboPiReferenceItem(): Promise<void> {
  const cat = await prisma.referenceCategory.findFirst({ where: { name: CATEGORY_NAME } });
  if (!cat) return;
  const existing = await prisma.referenceItem.findFirst({
    where: {
      categoryId: cat.id,
      OR: [{ label: "Pi" }, { label: "Shevbo-Pi" }],
    },
  });
  if (existing) return;
  await prisma.referenceItem.create({
    data: { categoryId: cat.id, label: PI_LABEL, value: PI_VALUE },
  });
}

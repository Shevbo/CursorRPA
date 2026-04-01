import { prisma } from "@/lib/prisma";

const CATEGORY_NAME = "Площадки";
const PI_LABEL = "Pi";
const PI_VALUE =
  "Shevbo-Pi — Raspberry Pi (LAN 192.168.1.105, Tailscale); пользователь shevbo; syslog-srv HTTP :4444, PingMaster HTTP :4555; снаружи — http:// (не https на портах).";

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

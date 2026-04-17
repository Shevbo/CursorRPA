import { prisma } from "@/lib/prisma";

export type AssistAllowlistPublic = {
  id: string;
  telegramUserId: string;
  note: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Если нет ни одной включённой записи — бот пускает всех. Иначе только из списка. */
export async function getAssistBotAllowlistSnapshot(projectSlug: string): Promise<{
  restricted: boolean;
  allowedTelegramUserIds: string[];
}> {
  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true },
  });
  if (!project) {
    return { restricted: false, allowedTelegramUserIds: [] };
  }

  const enabledRows = await prisma.assistBotAllowlistEntry.findMany({
    where: { projectId: project.id, enabled: true },
    select: { telegramUserId: true },
  });

  if (enabledRows.length === 0) {
    return { restricted: false, allowedTelegramUserIds: [] };
  }

  return {
    restricted: true,
    allowedTelegramUserIds: enabledRows.map((r) => r.telegramUserId.trim()).filter(Boolean),
  };
}

export function normalizeTelegramUserId(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{1,20}$/.test(s)) return null;
  return s;
}

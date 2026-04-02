import type { PrismaClient } from "@prisma/client";
import { mergeTelegramKeysFromBridgeEnv } from "@/lib/merge-telegram-bridge-env";
import { piPulseOverallStatus } from "@/lib/pi-pulse-status";

const prevPulseStatus = new Map<string, "ok" | "warn" | "critical">();

function payloadForStatus(payload: unknown): Parameters<typeof piPulseOverallStatus>[0] {
  if (!payload || typeof payload !== "object") return {};
  return payload as Parameters<typeof piPulseOverallStatus>[0];
}

async function sendTelegramToAdmins(text: string): Promise<void> {
  mergeTelegramKeysFromBridgeEnv();
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return;
  const raw = (process.env.TELEGRAM_ALLOWED_USER_IDS || "").trim();
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return;
  const payload = {
    text: text.slice(0, 3500),
    disable_web_page_preview: true,
  };
  for (const chatId of ids) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, chat_id: chatId }),
      });
    } catch {
      /* ignore */
    }
  }
}

async function notifyPortalAdmins(
  prisma: PrismaClient,
  title: string,
  body: string,
  href: string | null
): Promise<void> {
  const admins = await prisma.portalUser.findMany({
    where: { role: "admin" },
    select: { id: true },
  });
  for (const u of admins) {
    try {
      await prisma.portalNotification.create({
        data: {
          userId: u.id,
          kind: "pi_pulse",
          title: title.slice(0, 500),
          body,
          href: href ? href.slice(0, 4000) : null,
        },
      });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Колокольчик и Telegram только при **смене** статуса (нет спама каждые 5 мин).
 * Пульс в БД обновляется всегда в route POST.
 * PI_PULSE_TELEGRAM=0 — не слать в Telegram. PI_PULSE_TELEGRAM_HEARTBEAT=1 — слать в ТГ при каждом пульсе (краткий текст).
 */
export async function afterPiPulseIngest(
  prisma: PrismaClient,
  deviceKey: string,
  payloadJson: unknown
): Promise<void> {
  const payload = payloadForStatus(payloadJson);
  const status = piPulseOverallStatus(payload);
  const prev = prevPulseStatus.get(deviceKey) ?? "ok";

  const host = (payload as { hostname?: string }).hostname || deviceKey;
  const summary = `Pi ${host}: ${status}\nRAM free ${(payload.ram?.free_pct ?? 0).toFixed(1)}%, HDD free ${(payload.hdd?.free_pct ?? 0).toFixed(1)}%`;

  const telegramOn = (process.env.PI_PULSE_TELEGRAM || "1").trim() !== "0";
  const heartbeat = (process.env.PI_PULSE_TELEGRAM_HEARTBEAT || "").trim() === "1";

  if (heartbeat && telegramOn) {
    await sendTelegramToAdmins(`📟 Pi пульс\n${summary}`);
  }

  if (prev === status) {
    prevPulseStatus.set(deviceKey, status);
    return;
  }

  prevPulseStatus.set(deviceKey, status);

  const title =
    status === "ok"
      ? "Pi: снова ok"
      : status === "critical"
        ? "Pi: critical"
        : "Pi: предупреждение";

  await notifyPortalAdmins(prisma, title, summary, "/projects");

  if (!telegramOn || heartbeat) return;

  if (status === "ok") {
    await sendTelegramToAdmins(`✅ Shectory Pi снова в норме\n${summary}`);
  } else if (status === "critical") {
    await sendTelegramToAdmins(`🚨 Shectory Pi critical\n${summary}`);
  } else {
    await sendTelegramToAdmins(`⚠️ Shectory Pi предупреждение\n${summary}`);
  }
}

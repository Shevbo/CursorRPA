/**
 * Отправить уведомление в Telegram всем TELEGRAM_ALLOWED_USER_IDS.
 * Формат: жирный заголовок, тело, ссылка (если есть).
 * Не бросает исключений — ошибки только логируются.
 *
 * @param {{ kind?: string; title: string; body: string; href?: string | null }} payload
 * @param {string} [baseUrl] — базовый URL портала для абсолютных ссылок (напр. https://shectory.ru)
 */
async function notifyTelegram(payload, baseUrl) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const rawIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || "").trim();
  if (!token || !rawIds) return;

  const chatIds = rawIds.split(",").map((s) => s.trim()).filter(Boolean);
  if (chatIds.length === 0) return;

  const title = String(payload.title || "").trim();
  const body = String(payload.body || "").trim();
  const href = payload.href ? String(payload.href).trim() : null;

  // Build absolute URL if href is relative
  let linkLine = "";
  if (href) {
    const base = (baseUrl || process.env.PORTAL_BASE_URL || "https://shectory.ru").replace(/\/$/, "");
    const absUrl = href.startsWith("http") ? href : `${base}${href}`;
    linkLine = `\n🔗 <a href="${absUrl}">${absUrl}</a>`;
  }

  // Escape HTML special chars
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const text = [
    title ? `<b>${esc(title)}</b>` : null,
    body ? esc(body) : null,
    linkLine || null,
  ].filter(Boolean).join("\n");

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  for (const chatId of chatIds) {
    try {
      const r = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const err = await r.text().catch(() => "");
        console.error(`[portal-notify] Telegram sendMessage failed for chat_id=${chatId}: ${err.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`[portal-notify] Telegram error for chat_id=${chatId}:`, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} userId
 * @param {{ kind?: string; title: string; body: string; href?: string | null }} payload
 */
export async function notifyPortalUser(prisma, userId, payload) {
  const uid = String(userId || "").trim();
  if (!uid) return;
  try {
    await prisma.portalNotification.create({
      data: {
        userId: uid,
        kind: String(payload.kind || "general").slice(0, 96),
        title: String(payload.title || "").slice(0, 500),
        body: String(payload.body || ""),
        href: payload.href ? String(payload.href).slice(0, 4000) : null,
      },
    });
  } catch (e) {
    console.error("[portal-notify]", e instanceof Error ? e.message : e);
  }

  // Mirror to Telegram (non-blocking, errors are logged not thrown)
  notifyTelegram(payload).catch(() => {});
}

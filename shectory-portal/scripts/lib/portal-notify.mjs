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
}

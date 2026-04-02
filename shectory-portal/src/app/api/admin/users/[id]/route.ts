import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { currentPortalSessionFromRequest, normalizeEmail } from "@/lib/portal-auth";
import { isPortalUserRole } from "@/lib/portal-settings-registry";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sess = currentPortalSessionFromRequest(req);
  if (sess?.role !== "superadmin") {
    return NextResponse.json({ error: "Только superadmin может менять роли" }, { status: 403 });
  }

  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const role = String(body.role || "").trim();
  if (!isPortalUserRole(role)) {
    return NextResponse.json({ error: "Недопустимая роль" }, { status: 400 });
  }

  const target = await prisma.portalUser.findUnique({ where: { id: params.id }, select: { id: true, email: true, role: true } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const meEmail = sess.email ? normalizeEmail(sess.email) : "";
  if (target.role === "superadmin" && role !== "superadmin") {
    const cnt = await prisma.portalUser.count({ where: { role: "superadmin" } });
    if (cnt <= 1) {
      return NextResponse.json({ error: "Нельзя снять последнего superadmin" }, { status: 400 });
    }
  }
  if (meEmail && normalizeEmail(target.email) === meEmail && target.role === "superadmin" && role !== "superadmin") {
    const cnt = await prisma.portalUser.count({ where: { role: "superadmin" } });
    if (cnt <= 1) {
      return NextResponse.json({ error: "Нельзя снять с себя superadmin, если вы единственный" }, { status: 400 });
    }
  }

  await prisma.portalUser.update({
    where: { id: params.id },
    data: { role },
  });

  return NextResponse.json({ ok: true });
}

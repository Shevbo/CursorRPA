import { NextResponse } from "next/server";
import { findPortalUser, normalizeEmail, passwordMatches } from "@/lib/portal-auth";
import { prisma } from "@/lib/prisma";

/**
 * Сервер-сервер: проверка email/пароля против каталога портала (PortalUser).
 * Защита: заголовок Authorization: Bearer ${SHECTORY_AUTH_BRIDGE_SECRET}.
 * Потребители: прикладные приложения Shectory (например ourdiary) с тем же секретом в .env.
 */
export async function POST(req: Request) {
  const secret = process.env.SHECTORY_AUTH_BRIDGE_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  if (!secret) {
    return NextResponse.json({ error: "SHECTORY_AUTH_BRIDGE_SECRET is not set" }, { status: 503 });
  }
  const expected = `Bearer ${secret}`;
  if (auth !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const user = await findPortalUser(email);
  if (!user?.passwordHash || !passwordMatches(password, user.passwordHash)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.portalUserProfile.findUnique({
    where: { userId: user.id },
    select: { fullName: true },
  });

  return NextResponse.json({
    ok: true,
    email: user.email,
    role: user.role,
    fullName: profile?.fullName?.trim() ?? "",
  });
}

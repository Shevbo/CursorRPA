import { NextResponse } from "next/server";
import {
  ensureDefaultAdminUser,
  findPortalUser,
  issueSessionCookie,
  passwordMatches,
  validateEmail,
} from "@/lib/portal-auth";

export async function POST(req: Request) {
  await ensureDefaultAdminUser();
  let body: { token?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String((body as unknown as { email?: unknown }).email ?? "").trim().toLowerCase();
  const password = String((body as unknown as { password?: unknown }).password ?? "");
  const token = String(body.token ?? "").trim();

  if (!validateEmail(email)) return NextResponse.json({ error: "Некорректный e-mail" }, { status: 400 });

  // Legacy fallback for existing ADMIN_TOKEN flow.
  const legacy = process.env.ADMIN_TOKEN?.trim();
  const legacyEmail = (process.env.ADMIN_EMAIL || "bshevelev@mail.ru").trim().toLowerCase();
  if (legacy && ((email === legacyEmail && password === legacy) || token === legacy)) {
    const res = NextResponse.json({ ok: true, legacy: true });
    const secure = process.env.NODE_ENV === "production";
    res.cookies.set("shectory_admin", legacy, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  const user = await findPortalUser(email);
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  if (!user.passwordHash) {
    return NextResponse.json({ needSetPassword: true, email }, { status: 409 });
  }
  if (!passwordMatches(password, user.passwordHash)) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  const issued = issueSessionCookie(user.role, user.email);
  res.cookies.set(issued.name, issued.value, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: issued.maxAge,
  });
  return res;
}

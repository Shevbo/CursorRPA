import { NextResponse } from "next/server";
import { findPortalUser, setPortalUserPassword, validateEmail, validatePassword } from "@/lib/portal-auth";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!validateEmail(email)) return NextResponse.json({ error: "Некорректный e-mail" }, { status: 400 });
  const pErr = validatePassword(password);
  if (pErr) return NextResponse.json({ error: pErr }, { status: 400 });
  const user = await findPortalUser(email);
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  if (user.passwordHash) return NextResponse.json({ error: "Пароль уже задан" }, { status: 409 });
  await setPortalUserPassword(email, password, true);
  return NextResponse.json({ ok: true });
}


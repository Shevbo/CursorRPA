import { NextResponse } from "next/server";
import {
  consumeEmailCode,
  issueSessionCookie,
  setPortalUserPassword,
  validateEmail,
  validatePassword,
} from "@/lib/portal-auth";

export async function POST(req: Request) {
  let body: { email?: string; code?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");
  if (!validateEmail(email)) return NextResponse.json({ error: "Некорректный e-mail" }, { status: 400 });
  const pErr = validatePassword(password);
  if (pErr) return NextResponse.json({ error: pErr }, { status: 400 });
  const ok = await consumeEmailCode(email, "register", code);
  if (!ok) return NextResponse.json({ error: "Неверный или просроченный код" }, { status: 400 });
  const user = await setPortalUserPassword(email, password, true);
  const issued = issueSessionCookie(user.role, user.email);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(issued.name, issued.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: issued.maxAge,
  });
  return res;
}


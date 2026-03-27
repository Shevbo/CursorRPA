import { NextResponse } from "next/server";
import { createEmailCode, findPortalUser, validateEmail } from "@/lib/portal-auth";

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!validateEmail(email)) return NextResponse.json({ error: "Некорректный e-mail" }, { status: 400 });
  const existing = await findPortalUser(email);
  if (existing?.passwordHash) return NextResponse.json({ error: "Пользователь уже зарегистрирован" }, { status: 409 });
  const sent = await createEmailCode(email, "register");
  return NextResponse.json({ ok: true, ...sent });
}


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
  const user = await findPortalUser(email);
  if (!user || !user.passwordHash) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  const sent = await createEmailCode(email, "reset");
  return NextResponse.json({ ok: true, ...sent });
}


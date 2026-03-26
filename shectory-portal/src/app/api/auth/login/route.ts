import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: true, message: "ADMIN_TOKEN не задан — вход не требуется." });
  }
  const expectedEmail = (process.env.ADMIN_EMAIL || "bshevelev@mail.ru").trim().toLowerCase();
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String((body as unknown as { email?: unknown }).email ?? "").trim().toLowerCase();
  const password = String((body as unknown as { password?: unknown }).password ?? "").trim();
  const token = String(body.token ?? "").trim();

  const ok =
    // новый формат
    (email === expectedEmail && password === expected) ||
    // backward-compatible: старое поле token (пароль = ADMIN_TOKEN)
    token === expected;

  if (!ok) return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set("shectory_admin", expected, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "komiss/lib/prisma";
import { randomUUID } from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, full_name } = body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Требуются email и пароль" },
        { status: 400 }
      );
    }
    const existing = await prisma.users.findFirst({
      where: { email: email.trim().toLowerCase(), is_sso_user: false },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Пользователь с таким email уже зарегистрирован" },
        { status: 400 }
      );
    }
    const hashed = await bcrypt.hash(password, 10);
    const id = randomUUID();
    await prisma.$transaction([
      prisma.users.create({
        data: {
          id,
          email: email.trim().toLowerCase(),
          encrypted_password: hashed,
          email_confirmed_at: new Date(),
          is_sso_user: false,
        },
      }),
      prisma.profiles.create({
        data: {
          id,
          full_name: typeof full_name === "string" ? full_name.trim() || null : null,
          email: email.trim().toLowerCase(),
          role: "user",
        },
      }),
    ]);
    return NextResponse.json({ ok: true, user_id: id });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка регистрации" },
      { status: 500 }
    );
  }
}

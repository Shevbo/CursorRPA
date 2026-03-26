import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, full_name } = body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return NextResponse.json({ error: "Требуются email и пароль" }, { status: 400 });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.users.findFirst({
      where: { email: normalizedEmail, is_sso_user: false },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Пользователь с таким email уже зарегистрирован" }, { status: 400 });
    }
    const hashed = await bcrypt.hash(password, 10);
    const id = randomUUID();
    await prisma.$transaction([
      prisma.users.create({
        data: {
          id,
          email: normalizedEmail,
          encrypted_password: hashed,
          email_confirmed_at: new Date(),
          is_sso_user: false,
        },
      }),
      prisma.profiles.create({
        data: {
          id,
          full_name: typeof full_name === "string" ? full_name.trim() || null : null,
          email: normalizedEmail,
          role: "user",
        },
      }),
    ]);
    return NextResponse.json({ ok: true, user_id: id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка регистрации" },
      { status: 500 }
    );
  }
}


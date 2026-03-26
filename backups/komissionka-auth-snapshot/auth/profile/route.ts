import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "komiss/lib/auth";
import { prisma } from "komiss/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ profile: null }, { status: 200 });
  }

  const profile = await prisma.profiles.findUnique({
    where: { id: session.user.id },
    select: {
      full_name: true,
      avatar_url: true,
      role: true,
      telegram_id: true,
      telegram_username: true,
      phone: true,
      preferred_location: true,
      email_notifications_enabled: true,
      email: true,
      created_at: true,
    },
  });

  if (!profile) {
    return NextResponse.json({
      profile: {
        full_name: null,
        avatar_url: null,
        role: null,
        telegram_id: null,
        telegram_username: null,
        phone: null,
        preferred_location: null,
        email_notifications_enabled: true,
        email: null,
        created_at: null,
        profile_number: null,
      },
    });
  }

  let profile_number: number | null = null;
  if (profile.created_at) {
    profile_number = await prisma.profiles.count({
      where: {
        created_at: {
          lte: profile.created_at,
        },
      },
    });
  }

  return NextResponse.json({
    profile: {
      ...profile,
      profile_number,
    },
  });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    full_name,
    phone,
    email,
    preferred_location,
    email_notifications_enabled,
  } = (body as {
    full_name?: unknown;
    phone?: unknown;
    email?: unknown;
    preferred_location?: unknown;
    email_notifications_enabled?: unknown;
  }) ?? {};

  const updatesProfile: Record<string, unknown> = {};
  const updatesUser: Record<string, unknown> = {};

  if (typeof full_name === "string") {
    updatesProfile.full_name = full_name.trim() || null;
  }
  if (typeof phone === "string") {
    updatesProfile.phone = phone.trim() || null;
  }
  if (typeof preferred_location === "string") {
    updatesProfile.preferred_location = preferred_location.trim() || null;
  }
  if (typeof email_notifications_enabled === "boolean") {
    updatesProfile.email_notifications_enabled = email_notifications_enabled;
  }
  if (typeof email === "string") {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return NextResponse.json({ error: "Email не может быть пустым" }, { status: 400 });
    }
    updatesProfile.email = normalizedEmail;
    updatesUser.email = normalizedEmail;
  }

  if (Object.keys(updatesProfile).length === 0 && Object.keys(updatesUser).length === 0) {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (updatesUser.email) {
        const existingUser = await tx.users.findFirst({
          where: {
            email: updatesUser.email as string,
            is_sso_user: false,
            NOT: { id: session.user.id },
          },
          select: { id: true },
        });
        if (existingUser) {
          throw new Error("Пользователь с таким email уже существует");
        }
      }

      if (Object.keys(updatesUser).length > 0) {
        await tx.users.update({
          where: { id: session.user.id },
          data: updatesUser,
        });
      }

      const updatedProfile = await tx.profiles.update({
        where: { id: session.user.id },
        data: updatesProfile,
        select: {
          full_name: true,
          avatar_url: true,
          role: true,
          telegram_id: true,
          telegram_username: true,
          phone: true,
          preferred_location: true,
          email_notifications_enabled: true,
          email: true,
          created_at: true,
        },
      });

      return updatedProfile;
    });

    let profile_number: number | null = null;
    if (result.created_at) {
      profile_number = await prisma.profiles.count({
        where: {
          created_at: {
            lte: result.created_at,
          },
        },
      });
    }

    return NextResponse.json({
      profile: {
        ...result,
        profile_number,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Не удалось обновить профиль";
    const status = message.includes("уже существует") ? 400 : 500;
    console.error("Profile PATCH error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.users.delete({
      where: { id: session.user.id },
    });
  } catch (err) {
    console.error("Profile DELETE error:", err);
    return NextResponse.json(
      { error: "Не удалось удалить профиль. Попробуйте позже." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

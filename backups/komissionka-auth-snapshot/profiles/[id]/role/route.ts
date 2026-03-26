import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "komiss/lib/auth";
import { prisma } from "komiss/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const profile = session?.user?.id
    ? await prisma.profiles.findUnique({ where: { id: session.user.id }, select: { role: true } })
    : null;
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json();
  const role = body?.role;
  if (role !== "user" && role !== "admin") {
    return NextResponse.json({ error: "role must be user or admin" }, { status: 400 });
  }
  if (id === session?.user?.id && role === "user") {
    return NextResponse.json({ error: "Cannot demote yourself" }, { status: 400 });
  }
  await prisma.profiles.update({ where: { id }, data: { role } });
  return NextResponse.json({ ok: true });
}

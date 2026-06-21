import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { updates?: Array<{ id: string; weight?: number; useProxy?: boolean }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "updates array required" }, { status: 400 });
  }

  for (const u of updates) {
    if (!u.id) continue;
    const data: Record<string, unknown> = {};
    if (typeof u.weight === "number") {
      data.weight = Math.max(1, Math.min(100, Math.round(u.weight)));
    }
    if (typeof u.useProxy === "boolean") {
      data.useProxy = u.useProxy;
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.projectModel.update({
      where: { id: u.id },
      data,
    });
  }

  return NextResponse.json({ ok: true });
}

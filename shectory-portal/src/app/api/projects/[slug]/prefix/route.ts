import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

function normalizePrefix(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = params.slug?.trim();
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  let body: { ticketPrefix?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const raw = typeof body.ticketPrefix === "string" ? body.ticketPrefix : "";
  const ticketPrefix = normalizePrefix(raw);
  if (!ticketPrefix || ticketPrefix.length > 5) {
    return NextResponse.json({ error: "ticketPrefix must be A-Z, 1..5 chars" }, { status: 400 });
  }

  try {
    const updated = await prisma.project.update({
      where: { slug },
      data: { ticketPrefix },
      select: { id: true, slug: true, ticketPrefix: true },
    });
    return NextResponse.json({ ok: true, project: updated });
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
}


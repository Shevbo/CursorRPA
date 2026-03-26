import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { buildArchitectureMermaid } from "@/lib/architecture";

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { slug?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const slug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : null;

  const projects = await prisma.project.findMany({
    where: slug ? { slug } : undefined,
    select: { id: true, slug: true, name: true, registryMetaJson: true },
  });
  if (slug && projects.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let updated = 0;
  for (const p of projects) {
    const chart = buildArchitectureMermaid(p);
    await prisma.project.update({ where: { id: p.id }, data: { architectureMermaid: chart } });
    updated += 1;
  }

  return NextResponse.json({ ok: true, updated, scope: slug ? "project" : "all" });
}


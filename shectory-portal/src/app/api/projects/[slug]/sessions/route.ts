import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = params.slug?.trim();
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: { title?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Admin — assistant";

  const session = await prisma.chatSession.create({
    data: { projectId: project.id, title },
    select: { id: true, title: true, projectId: true },
  });
  return NextResponse.json({ ok: true, session });
}


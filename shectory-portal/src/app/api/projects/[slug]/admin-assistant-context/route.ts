import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { buildAdminAssistantPrompt } from "@/lib/admin-assistant-prompt";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = params.slug?.trim();
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { name: true, slug: true, uiUrl: true, repoUrl: true, workspacePath: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json({
    prompt: buildAdminAssistantPrompt(project),
  });
}

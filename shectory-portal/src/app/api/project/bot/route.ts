import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { configureProjectBot, getProjectBotStatus } from "@/lib/project-bot";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const status = await getProjectBotStatus(project.slug);
  return NextResponse.json({ status });
}

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { projectId?: string; token?: string; allowedUserIds?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { projectId, token, allowedUserIds } = body;
  if (!projectId || !token?.trim() || !allowedUserIds?.trim()) {
    return NextResponse.json({ error: "projectId, token, allowedUserIds required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true, workspacePath: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const status = await configureProjectBot({
    projectSlug: project.slug,
    workspacePath: project.workspacePath,
    token,
    allowedUserIds,
  });
  return NextResponse.json({ status });
}

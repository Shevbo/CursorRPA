import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { adminAuthOk } from "@/lib/admin-auth";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";
import { prisma } from "@/lib/prisma";

type WelcomeArtifacts = {
  shectoryLogo?: string;
  projectLogo?: string;
  mainFrameBrief?: string;
};

function readWelcome(meta: unknown): WelcomeArtifacts {
  const obj = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  const w = (obj.welcomeArtifacts && typeof obj.welcomeArtifacts === "object"
    ? obj.welcomeArtifacts
    : {}) as Record<string, unknown>;
  return {
    shectoryLogo: typeof w.shectoryLogo === "string" ? w.shectoryLogo : "",
    projectLogo: typeof w.projectLogo === "string" ? w.projectLogo : "",
    mainFrameBrief: typeof w.mainFrameBrief === "string" ? w.mainFrameBrief : "",
  };
}

function missing(a: WelcomeArtifacts): string[] {
  const out: string[] = [];
  if (!String(a.mainFrameBrief ?? "").trim()) out.push("main_frame_brief");
  return out;
}

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const project = await prisma.project.findUnique({
    where: { slug: params.slug },
    select: { slug: true, registryMetaJson: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const artifacts = readWelcome(project.registryMetaJson);
  const me = currentPortalSessionFromRequest(req);
  return NextResponse.json({
    ok: true,
    artifacts,
    missing: missing(artifacts),
    user: me ? { email: me.email, role: me.role } : null,
  });
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { mainFrameBrief?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const project = await prisma.project.findUnique({
    where: { slug: params.slug },
    select: { id: true, registryMetaJson: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const prev = (project.registryMetaJson && typeof project.registryMetaJson === "object"
    ? project.registryMetaJson
    : {}) as Record<string, unknown>;
  const nextWelcome = {
    mainFrameBrief: String(body.mainFrameBrief ?? "").trim(),
  };
  const nextMeta: Record<string, unknown> = {
    ...prev,
    welcomeArtifacts: nextWelcome,
  };
  await prisma.project.update({
    where: { id: project.id },
    data: { registryMetaJson: nextMeta as Prisma.InputJsonValue },
  });
  return NextResponse.json({ ok: true, artifacts: nextWelcome, missing: missing(nextWelcome) });
}


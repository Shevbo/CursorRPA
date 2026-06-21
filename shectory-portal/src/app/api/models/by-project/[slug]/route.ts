import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = params.slug?.trim();
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const projectModels = await prisma.projectModel.findMany({
    where: { projectId: project.id },
    include: {
      provider: {
        select: { id: true, name: true, label: true, icon: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ ok: true, projectModels });
}

type PostBody = {
  providerId?: unknown;
  modelId?: unknown;
  label?: unknown;
  isDefault?: unknown;
};

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = params.slug?.trim();
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerId = String(body.providerId ?? "").trim();
  const modelId = String(body.modelId ?? "").trim();
  const label = String(body.label ?? "").trim();
  const isDefault = body.isDefault === true;

  if (!providerId || !modelId) {
    return NextResponse.json({ error: "providerId and modelId required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const provider = await prisma.modelProvider.findUnique({
    where: { id: providerId },
    select: { id: true, enabled: true },
  });
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  if (!provider.enabled) return NextResponse.json({ error: "Provider is disabled" }, { status: 400 });

  // If setting as default, unset any existing default for this project
  if (isDefault) {
    await prisma.projectModel.updateMany({
      where: { projectId: project.id, isDefault: true },
      data: { isDefault: false },
    });
  }

  const created = await prisma.projectModel.create({
    data: {
      projectId: project.id,
      providerId,
      modelId,
      label: label || modelId,
      isDefault,
    },
    include: {
      provider: {
        select: { id: true, name: true, label: true, icon: true },
      },
    },
  });

  return NextResponse.json({ ok: true, projectModel: created });
}

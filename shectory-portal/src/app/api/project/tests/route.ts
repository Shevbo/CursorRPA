import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

function normalizePrefix(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const [modules, testCases] = await Promise.all([
    prisma.testModule.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    prisma.testCase.findMany({
      where: { projectId },
      include: { module: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return NextResponse.json({ modules, testCases });
}

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: {
    projectId?: string;
    moduleName?: string;
    title?: string;
    description?: string;
    kind?: string;
    scope?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { projectId, moduleName, title, description, kind, scope } = body;
  if (!projectId || !title?.trim()) {
    return NextResponse.json({ error: "projectId and title required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ticketPrefix: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const prefix = project.ticketPrefix ? normalizePrefix(project.ticketPrefix) : "";
  if (!prefix) {
    return NextResponse.json(
      { error: "Project ticketPrefix is required before creating the first test case", code: "ticket_prefix_required" },
      { status: 409 }
    );
  }

  let moduleId: string | null = null;
  if (moduleName?.trim()) {
    const mod = await prisma.testModule.upsert({
      where: { projectId_name: { projectId, name: moduleName.trim() } },
      create: { projectId, name: moduleName.trim() },
      update: {},
    });
    moduleId = mod.id;
  }
  const tc = await prisma.$transaction(async (tx) => {
    await tx.projectTestCaseCounter.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, nextSeq: 1 },
      update: {},
    });
    const counter = await tx.projectTestCaseCounter.update({
      where: { projectId: project.id },
      data: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });
    const seq = counter.nextSeq - 1;
    const caseKey = `${prefix}-T${seq}`;
    return await tx.testCase.create({
      data: {
        projectId,
        moduleId,
        caseKey,
        caseSeq: seq,
        title: title.trim(),
        description: description?.trim() || "",
        kind: kind?.trim() || "manual-guided",
        scope: scope?.trim() || "ui",
      },
      include: { module: true },
    });
  });
  return NextResponse.json({ testCase: tc });
}

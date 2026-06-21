import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: Request, { params }: { params: { slug: string; modelId: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = params.slug?.trim();
  const modelEntryId = params.modelId?.trim(); // This is the ProjectModel.id, not the provider's modelId

  if (!slug || !modelEntryId) {
    return NextResponse.json({ error: "Missing slug or modelId" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Verify the model entry belongs to this project
  const entry = await prisma.projectModel.findFirst({
    where: { id: modelEntryId, projectId: project.id },
  });
  if (!entry) return NextResponse.json({ error: "Model not found in project" }, { status: 404 });

  await prisma.projectModel.delete({ where: { id: modelEntryId } });

  return NextResponse.json({ ok: true });
}

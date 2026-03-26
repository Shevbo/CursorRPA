import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const environments = await prisma.deployEnvironment.findMany({
    where: { projectId },
    orderBy: [{ isProd: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ environments });
}

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: {
    projectId?: string;
    name?: string;
    branch?: string;
    targetHost?: string;
    directory?: string;
    isProd?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { projectId, name, branch, targetHost, directory, isProd } = body;
  if (!projectId || !name?.trim()) {
    return NextResponse.json({ error: "projectId and name required" }, { status: 400 });
  }
  const env = await prisma.deployEnvironment.create({
    data: {
      projectId,
      name: name.trim(),
      branch: branch?.trim() || "main",
      targetHost: targetHost?.trim() || null,
      directory: directory?.trim() || null,
      isProd: Boolean(isProd),
    },
  });
  return NextResponse.json({ environment: env });
}

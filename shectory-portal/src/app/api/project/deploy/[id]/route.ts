import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

type Ctx = { params: { id: string } };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { status?: string; branch?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const env = await prisma.deployEnvironment.update({
    where: { id: params.id },
    data: { status: body.status, branch: body.branch },
  });
  return NextResponse.json({ environment: env });
}

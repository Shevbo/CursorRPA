import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const providers = await prisma.modelProvider.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      label: true,
      baseUrl: true,
      apiKeyRef: true,
      enabled: true,
      icon: true,
    },
  });

  return NextResponse.json({ ok: true, providers });
}

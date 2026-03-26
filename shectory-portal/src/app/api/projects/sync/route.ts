import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { syncProjectsFromWorkspaces } from "@/lib/project-registry";

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await syncProjectsFromWorkspaces();
  return NextResponse.json({ result }, { status: result.ok ? 200 : 500 });
}

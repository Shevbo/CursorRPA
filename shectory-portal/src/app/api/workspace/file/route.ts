import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

function safeJoin(root: string, rel: string): string | null {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.resolve(root, cleaned);
  const rootAbs = path.resolve(root);
  if (full === rootAbs) return null;
  if (!full.startsWith(rootAbs + path.sep)) return null;
  return full;
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId")?.trim() || "";
  const file = searchParams.get("path")?.trim() || "";
  if (!projectId) return NextResponse.json({ error: "projectId" }, { status: 400 });
  if (!file) return NextResponse.json({ error: "path" }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  const root = project.workspacePath;
  if (!root || !fs.existsSync(root)) return NextResponse.json({ error: "workspace not found" }, { status: 404 });

  const full = safeJoin(root, file);
  if (!full) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  let st: fs.Stats;
  try {
    st = fs.statSync(full);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!st.isFile()) return NextResponse.json({ error: "not a file" }, { status: 400 });
  if (st.size > 512 * 1024) return NextResponse.json({ error: "file too large" }, { status: 413 });

  const content = fs.readFileSync(full, "utf8");
  return NextResponse.json({ ok: true, path: file, content });
}


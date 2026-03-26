import * as fs from "node:fs";
import * as path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";

const IGNORE = new Set(["node_modules", ".git", ".next", "dist", "build"]);

function walk(dir: string, prefix: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  const lines: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [`${prefix} [нет доступа]`];
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORE.has(e.name)) continue;
    const p = path.join(dir, e.name);
    const line = `${prefix}${e.isDirectory() ? "📁 " : "📄 "}${e.name}`;
    lines.push(line);
    if (e.isDirectory() && depth < maxDepth) {
      lines.push(...walk(p, prefix + "  ", depth + 1, maxDepth));
    }
  }
  return lines;
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId" }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  const root = project.workspacePath;
  if (!fs.existsSync(root)) {
    return NextResponse.json({ output: `(каталог ещё не склонирован)\n${root}` });
  }
  const lines = walk(root, "", 0, 3);
  return NextResponse.json({ output: lines.join("\n") });
}

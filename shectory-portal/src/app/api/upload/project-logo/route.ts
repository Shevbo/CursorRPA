import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 2_500_000; // ~2.5MB
const ALLOWED = new Set(["image/png", "image/gif", "image/webp", "image/jpeg"]);

function extForType(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  return "bin";
}

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const form = await req.formData();
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const file = form.get("file");
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: "File too large" }, { status: 413 });

  const ext = extForType(file.type);
  const safeSlug = slug.replace(/[^a-z0-9-]/g, "").slice(0, 40) || "project";
  const filename = `${safeSlug}-${Date.now()}.${ext}`;

  // Resolve to repo-root public/ to serve via Next.js static.
  const publicDir = path.join(process.cwd(), "public");
  const relDir = path.join("uploads", "project-logos");
  const outDir = path.join(publicDir, relDir);
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, filename);
  await writeFile(outPath, buf);

  const urlPath = `/${relDir.replace(/\\/g, "/")}/${filename}`;
  return NextResponse.json({ ok: true, url: urlPath, bytes: buf.length, type: file.type });
}


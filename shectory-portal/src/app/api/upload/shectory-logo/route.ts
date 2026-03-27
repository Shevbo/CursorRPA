import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 3_500_000; // ~3.5MB
const ALLOWED = new Set(["image/gif", "image/webp", "image/png", "image/jpeg"]);

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: "File too large" }, { status: 413 });

  const publicDir = path.join(process.cwd(), "public");
  const brandDir = path.join(publicDir, "brand");
  await mkdir(brandDir, { recursive: true });
  const outPath = path.join(brandDir, "shectory-logo.gif");
  await writeFile(outPath, buf);

  // Same URL path (cache buster for clients).
  return NextResponse.json({ ok: true, url: "/brand/shectory-logo.gif", bust: Date.now(), bytes: buf.length, type: file.type });
}


import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import fs from "node:fs/promises";
import path from "node:path";

// Store sound outside public/ so it survives deploys and is served via this API route
const SOUND_DIR = path.join(process.cwd(), "..", "data", "portal-sounds");
const SOUND_PATH = path.join(SOUND_DIR, "notification.mp3");
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let buf: Buffer;
  try {
    buf = await fs.readFile(SOUND_PATH);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.length),
      "Cache-Control": "no-cache",
    },
  });
}

export async function POST(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_SIZE) {
    return NextResponse.json({ error: `Файл слишком большой (макс. ${MAX_SIZE / 1024}KB)` }, { status: 400 });
  }

  await fs.mkdir(SOUND_DIR, { recursive: true });
  await fs.writeFile(SOUND_PATH, buf);

  return NextResponse.json({ ok: true, size: buf.length });
}

export async function DELETE(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await fs.unlink(SOUND_PATH);
  } catch {
    // ignore if not exists
  }
  return NextResponse.json({ ok: true });
}

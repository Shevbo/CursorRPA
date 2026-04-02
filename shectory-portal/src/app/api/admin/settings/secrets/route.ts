import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { isSuperAdminRequest } from "@/lib/portal-auth";
import { setSecretSetting } from "@/lib/portal-settings";

export async function POST(req: Request) {
  if (!adminAuthOk(req) || !isSuperAdminRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const key = String(body.key || "").trim();
  const value = body.value === undefined || body.value === null ? "" : String(body.value);
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  try {
    await setSecretSetting(key, value);
  } catch {
    return NextResponse.json({ error: "Недопустимый ключ секрета" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

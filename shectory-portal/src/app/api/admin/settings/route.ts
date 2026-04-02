import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { isSuperAdminRequest } from "@/lib/portal-auth";
import { listPublicSettings, updatePortalSettings } from "@/lib/portal-settings";
import { PORTAL_SETTING_GROUPS } from "@/lib/portal-settings-registry";
import { loadRuntimeEnvIntoProcess } from "@/lib/portal-runtime-env";

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  loadRuntimeEnvIntoProcess();
  const settings = await listPublicSettings();
  return NextResponse.json({
    ok: true,
    groups: PORTAL_SETTING_GROUPS,
    settings,
    canEditSecrets: isSuperAdminRequest(req),
  });
}

export async function PATCH(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { values?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const values = body.values && typeof body.values === "object" ? body.values : null;
  if (!values) return NextResponse.json({ error: "values required" }, { status: 400 });

  const strMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    strMap[k] = v === null || v === undefined ? "" : String(v);
  }

  await updatePortalSettings(strMap, { allowSecrets: false });
  return NextResponse.json({ ok: true });
}

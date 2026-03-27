import { NextResponse } from "next/server";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";

export async function GET(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, user: null }, { status: 401 });
  return NextResponse.json({ ok: true, user: { email: s.email, role: s.role } });
}


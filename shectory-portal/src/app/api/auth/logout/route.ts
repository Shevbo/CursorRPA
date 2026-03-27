import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/portal-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}

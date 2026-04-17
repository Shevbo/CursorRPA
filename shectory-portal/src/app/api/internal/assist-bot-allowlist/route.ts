import { NextResponse } from "next/server";
import { getAssistBotAllowlistSnapshot } from "@/lib/assist-allowlist";

/**
 * Сервер-сервер: снимок allowlist для Telegram-бота Shectory Assist на hoster.
 * Authorization: Bearer ${SHECTORY_AUTH_BRIDGE_SECRET} — тот же секрет, что для verify-portal-credentials.
 */
export async function GET(req: Request) {
  const secret = process.env.SHECTORY_AUTH_BRIDGE_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  if (!secret) {
    return NextResponse.json({ error: "SHECTORY_AUTH_BRIDGE_SECRET is not set" }, { status: 503 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const slug = (searchParams.get("slug") ?? "shectory-assist").trim() || "shectory-assist";

  const snap = await getAssistBotAllowlistSnapshot(slug);
  return NextResponse.json(snap);
}

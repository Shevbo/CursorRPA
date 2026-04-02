import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { afterPiPulseIngest } from "@/lib/pi-pulse-notify";
import { piPulseOverallStatus } from "@/lib/pi-pulse-status";

function pulseTokenOk(header: string | null): boolean {
  const secret = (process.env.PI_PULSE_INGEST_SECRET || "").trim();
  if (!secret) return false;
  const raw = (header || "").trim();
  const prefix = "Bearer ";
  if (!raw.startsWith(prefix)) return false;
  const tok = raw.slice(prefix.length).trim();
  try {
    const a = Buffer.from(tok, "utf8");
    const b = Buffer.from(secret, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function normalizePayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const o = body as Record<string, unknown>;
  const { deviceKey: _d, token: _t, ...rest } = o;
  return rest;
}

/**
 * POST — пульс с Raspberry Pi (HTTPS, без VPN). Заголовок: Authorization: Bearer <PI_PULSE_INGEST_SECRET>
 */
export async function POST(req: Request) {
  const secret = (process.env.PI_PULSE_INGEST_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "PI_PULSE_INGEST_SECRET не задан на портале" }, { status: 503 });
  }
  if (!pulseTokenOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const deviceKeyRaw = typeof b.deviceKey === "string" ? b.deviceKey.trim().slice(0, 64) : "";
  const deviceKey = deviceKeyRaw || "default";

  const payloadJson = normalizePayload(body);
  const receivedAt = new Date();
  const payloadInput = payloadJson as Prisma.InputJsonValue;

  await prisma.piHealthPulse.upsert({
    where: { deviceKey },
    create: {
      deviceKey,
      receivedAt,
      payloadJson: payloadInput,
    },
    update: {
      receivedAt,
      payloadJson: payloadInput,
    },
  });

  await afterPiPulseIngest(prisma, deviceKey, payloadJson);

  const status = piPulseOverallStatus(payloadJson as Parameters<typeof piPulseOverallStatus>[0]);
  return NextResponse.json({ ok: true, deviceKey, status, receivedAt: receivedAt.toISOString() });
}

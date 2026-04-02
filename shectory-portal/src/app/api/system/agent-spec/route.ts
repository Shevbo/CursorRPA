import { NextResponse } from "next/server";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";
import { prisma } from "@/lib/prisma";
import { loadRuntimeEnvIntoProcess } from "@/lib/portal-runtime-env";

function defaultSpec(): { executor: string; auditor: string } {
  return {
    executor: "Gemini 3 Flash (gemini-3-flash)",
    auditor: "Gemini 3.1 Pro (gemini-3.1-pro)",
  };
}

async function specFromDbOrEnv(key: string, envFallback: string, hardDefault: string): Promise<string> {
  const row = await prisma.portalSetting.findUnique({ where: { key }, select: { value: true } });
  const fromDb = row?.value?.trim();
  if (fromDb) return fromDb;
  const fromEnv = (process.env[key] || "").trim();
  if (fromEnv) return fromEnv;
  return (envFallback || "").trim() || hardDefault;
}

export async function GET(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  loadRuntimeEnvIntoProcess();
  const d = defaultSpec();
  const executor = await specFromDbOrEnv("SHECTORY_EXECUTOR_MODEL_SPEC", process.env.SHECTORY_EXECUTOR_MODEL_SPEC || "", d.executor);
  const auditor = await specFromDbOrEnv("SHECTORY_AUDITOR_MODEL_SPEC", process.env.SHECTORY_AUDITOR_MODEL_SPEC || "", d.auditor);

  return NextResponse.json({ ok: true, executor, auditor });
}

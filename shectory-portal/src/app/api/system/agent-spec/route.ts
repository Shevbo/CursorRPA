import { NextResponse } from "next/server";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";

function defaultSpec(): { executor: string; auditor: string } {
  // Defaults for Shectory UI (no secrets). Can be overridden by env vars below.
  return { executor: "Claude 4.6", auditor: "Gemini 3.1 Pro" };
}

export async function GET(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const d = defaultSpec();
  const executor = (process.env.SHECTORY_EXECUTOR_MODEL_SPEC || "").trim() || d.executor;
  const auditor = (process.env.SHECTORY_AUDITOR_MODEL_SPEC || "").trim() || d.auditor;

  return NextResponse.json({ ok: true, executor, auditor });
}


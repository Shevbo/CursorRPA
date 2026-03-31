import { NextResponse } from "next/server";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";

function defaultSpec(): { executor: string; auditor: string } {
  const agentBin = (process.env.AGENT_BIN || "~/.local/bin/agent").trim();
  const args = ["-p", "--trust", "--output-format text", "--workspace <path>"].join(" ");
  const base = `Cursor agent CLI (${agentBin}) args: ${args}`;
  return { executor: base, auditor: base };
}

export async function GET(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const d = defaultSpec();
  const executor = (process.env.SHECTORY_EXECUTOR_MODEL_SPEC || "").trim() || d.executor;
  const auditor = (process.env.SHECTORY_AUDITOR_MODEL_SPEC || "").trim() || d.auditor;

  return NextResponse.json({ ok: true, executor, auditor });
}


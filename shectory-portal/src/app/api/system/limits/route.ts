import { NextResponse } from "next/server";
import { currentPortalSessionFromRequest } from "@/lib/portal-auth";
import {
  getChatAttachmentMaxBytes,
  getChatAttachmentMaxFiles,
  getChatAttachmentMaxTotalBytes,
} from "@/lib/chat-attachments";
import { loadRuntimeEnvIntoProcess } from "@/lib/portal-runtime-env";

export async function GET(req: Request) {
  const s = currentPortalSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  loadRuntimeEnvIntoProcess();
  return NextResponse.json({
    ok: true,
    chatAttachmentMaxFiles: getChatAttachmentMaxFiles(),
    chatAttachmentMaxBytes: getChatAttachmentMaxBytes(),
    chatAttachmentMaxTotalBytes: getChatAttachmentMaxTotalBytes(),
  });
}

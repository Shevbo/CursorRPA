import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAuthOk } from "@/lib/admin-auth";
import { portalUserIdFromRequest } from "@/lib/portal-auth";
import { getAgentPromptTimeoutMs } from "@/lib/agent-timeout";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import type { Project } from "@prisma/client";
import {
  CHAT_ATTACHMENTS_DIR,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  safeAttachmentBasename,
  attachmentExtensionOk,
  type ChatAttachmentMeta,
} from "@/lib/chat-attachments";

function redactSecrets(text: string): string {
  return text.replace(/(sshpass\s+-p\s+)(\"[^\"]*\"|'[^']*'|\S+)/gi, "$1'***'");
}

async function writeSessionAttachments(
  workspacePath: string,
  sessionId: string,
  messageId: string,
  files: { name: string; data: Buffer }[]
): Promise<ChatAttachmentMeta[]> {
  const root = path.join(workspacePath, CHAT_ATTACHMENTS_DIR, sessionId, messageId);
  await fs.mkdir(root, { recursive: true });
  const used = new Set<string>();
  const out: ChatAttachmentMeta[] = [];
  for (const f of files) {
    const base0 = safeAttachmentBasename(f.name);
    const chk = attachmentExtensionOk(base0);
    if (!chk.ok) throw new Error(chk.reason || "Недопустимый файл");
    let base = base0;
    const dot = base.lastIndexOf(".");
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    const ext = dot >= 0 ? base.slice(dot) : "";
    let candidate = base;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem}_${n}${ext}`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    const abs = path.join(root, candidate);
    await fs.writeFile(abs, f.data);
    const relPath = path.join(CHAT_ATTACHMENTS_DIR, sessionId, messageId, candidate).replace(/\\/g, "/");
    out.push({ name: f.name, relPath });
  }
  return out;
}

function spawnAgentChat(
  project: Project,
  sessionId: string,
  userMsgId: string,
  opts?: { notifyUserId?: string | null }
) {
  const runnerPath = path.join(process.cwd(), "scripts", "agent-chat-runner.mjs");
  const payload = `msg:${userMsgId}`;
  const args = [runnerPath, sessionId, project.workspacePath, payload, String(getAgentPromptTimeoutMs())];
  const nuid = opts?.notifyUserId?.trim();
  if (nuid) args.push(nuid);
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/**
 * Enqueue a chat message for the agent.
 * If the agent is currently busy (processingMsgId is set), the message is saved
 * to the DB but the runner is NOT spawned — the runner will pick it up from the
 * queue after it finishes the current message.
 * Returns whether the runner was spawned immediately.
 */
async function enqueueAgentChat(
  project: Project,
  sessionId: string,
  userMsgId: string,
  opts?: { notifyUserId?: string | null }
): Promise<{ spawned: boolean }> {
  // Atomically claim the session if it's free (processingMsgId IS NULL → set it)
  const updated = await prisma.chatSession.updateMany({
    where: { id: sessionId, processingMsgId: null, isStopped: false },
    data: { processingMsgId: userMsgId },
  });
  if (updated.count === 0) {
    // Agent is busy — message is already saved in DB, runner will pick it up
    return { spawned: false };
  }
  spawnAgentChat(project, sessionId, userMsgId, opts);
  return { spawned: true };
}

type ParsedFile = { name: string; data: Buffer };

export async function POST(req: Request) {
  if (!adminAuthOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  let projectId: string | undefined;
  let projectSlug: string | undefined;
  let sessionId: string | undefined;
  let message = "";
  let files: ParsedFile[] = [];

  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
    }
    projectId = (form.get("projectId") as string | null)?.trim() || undefined;
    projectSlug = (form.get("projectSlug") as string | null)?.trim() || undefined;
    sessionId = (form.get("sessionId") as string | null)?.trim() || undefined;
    message = String(form.get("message") ?? "");

    const rawFiles = form.getAll("files");
    let total = 0;
    for (const entry of rawFiles) {
      if (!(entry instanceof Blob)) continue;
      const name = "name" in entry && typeof (entry as File).name === "string" ? (entry as File).name : "file";
      const buf = Buffer.from(await entry.arrayBuffer());
      if (buf.length > CHAT_ATTACHMENT_MAX_BYTES) {
        return NextResponse.json(
          { error: `Файл «${name}» слишком больший (макс. ${CHAT_ATTACHMENT_MAX_BYTES} байт на файл)` },
          { status: 400 }
        );
      }
      total += buf.length;
      if (total > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
        return NextResponse.json({ error: "Суммарный размер вложений превышает лимит" }, { status: 400 });
      }
      files.push({ name, data: buf });
    }
    if (files.length > CHAT_ATTACHMENT_MAX_FILES) {
      return NextResponse.json({ error: `Не более ${CHAT_ATTACHMENT_MAX_FILES} файлов за раз` }, { status: 400 });
    }
  } else {
    let body: { projectId?: string; projectSlug?: string; sessionId?: string; message?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    projectId = body.projectId;
    projectSlug = body.projectSlug;
    sessionId = body.sessionId;
    message = body.message ?? "";
  }

  const trimmed = message.trim();
  if ((!projectId && !projectSlug) || !sessionId) {
    return NextResponse.json({ error: "projectId|projectSlug, sessionId required" }, { status: 400 });
  }
  if (!trimmed && files.length === 0) {
    return NextResponse.json({ error: "Нужен текст сообщения или хотя бы одно вложение" }, { status: 400 });
  }

  const project = projectId
    ? await prisma.project.findUnique({ where: { id: projectId } })
    : await prisma.project.findUnique({ where: { slug: String(projectSlug) } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, projectId: project.id },
  });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  if (session.isStopped) {
    return NextResponse.json({ error: "Session is stopped" }, { status: 409 });
  }

  const cleanMessage = trimmed ? redactSecrets(trimmed) : "";
  const contentForDb = cleanMessage || "(только вложения)";

  const userMsg = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "user",
      content: contentForDb,
      attachmentsJson: "[]",
    },
  });

  let attachmentsJson = "[]";
  if (files.length > 0) {
    try {
      const meta = await writeSessionAttachments(project.workspacePath, sessionId, userMsg.id, files);
      attachmentsJson = JSON.stringify(meta);
      await prisma.chatMessage.update({
        where: { id: userMsg.id },
        data: { attachmentsJson },
      });
    } catch (e) {
      await prisma.chatMessage.delete({ where: { id: userMsg.id } }).catch(() => {});
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Не удалось сохранить вложения" },
        { status: 400 }
      );
    }
  }

  const notifyUserId = (await portalUserIdFromRequest(req)) ?? undefined;
  const { spawned } = await enqueueAgentChat(project, sessionId, userMsg.id, { notifyUserId });

  const userMsgOut = { ...userMsg, attachmentsJson };

  return NextResponse.json(
    {
      ok: true,
      async: true,
      queued: !spawned,
      userMsg: userMsgOut,
      sessionId,
      timeoutMs: getAgentPromptTimeoutMs(),
    },
    { status: 202 }
  );
}

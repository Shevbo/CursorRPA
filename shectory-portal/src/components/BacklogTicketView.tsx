"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { flushSync } from "react-dom";
import type { BacklogItem, ChatMessage, ChatSession, Sprint } from "@prisma/client";
import {
  CHAT_POST_MESSAGE_TYPE,
  CHAT_SCROLL_TO_BOTTOM_TYPE,
  type ChatAgentPresence,
  looksLikeAssistantBusy,
  looksLikeCommandFailure,
  looksLikeAssistantFailure,
  type TicketChatPostMessage,
} from "@/lib/agent-chat-presence";
import { collectClipboardFiles, mergePendingFiles, fmtFileSize } from "@/lib/chat-attachment-paste";
import { ChatPaperclipAttach } from "@/components/ChatPaperclipAttach";
import { AGENT_STATUS_EXT } from "@/generated/agent-status-ext";
import { BACKLOG_ITEM_STATUSES, BACKLOG_SPRINT_STATUSES } from "@/lib/backlog-constants";
import {
  buildFollowUpTicketUserPayload,
  buildFullTicketContextText,
  stripTicketContextRefreshTag,
  userRequestedTicketContextRefresh,
} from "@/lib/ticket-chat-context";
import { CHAT_ATTACHMENT_MAX_FILES } from "@/lib/chat-attachments";
import type { AgentRun, AgentRunStep } from "@prisma/client";

type SessionWithMessages = ChatSession & { messages: ChatMessage[] };
type ItemWithSprint = BacklogItem & { sprint?: Sprint | null };

type RunWithSteps = AgentRun & { steps: AgentRunStep[] };

const AUTO_SHELL_UNTIL_KEY = "shectory_backlog_auto_shell_until";
const AUTO_SHELL_MS = 2 * 60 * 60 * 1000;

/** Статусы агента: `icons agent status/` → sync → `public/brand/agent-status/` (gif или jpg, см. gen-agent-status-ext). */
const TICKET_AGENT_STATUS_VER = "7";
/** Высота превью статуса рядом с полем ввода (было 200px, −15%). */
const TICKET_AGENT_STATUS_IMG_PX = 170;
const ticketAgentStatusSrc = (name: keyof typeof AGENT_STATUS_EXT) =>
  `/brand/agent-status/${name}.${AGENT_STATUS_EXT[name]}?v=${TICKET_AGENT_STATUS_VER}`;

const TICKET_AGENT_STATUS_SRC: Record<ChatAgentPresence, string> = {
  thinking: ticketAgentStatusSrc("Thinking3"),
  auditing: ticketAgentStatusSrc("Auditing3"),
  idle: ticketAgentStatusSrc("Noduty3"),
  error: ticketAgentStatusSrc("Error3"),
};

function ticketIdLabel(item: ItemWithSprint) {
  return item.ticketKey || item.id.slice(0, 8);
}

export function BacklogTicketView({
  projectId,
  projectSlug,
  itemId,
  projectAiContext,
  projectTechStack,
  initialItem,
  initialSession,
}: {
  projectId: string;
  projectSlug: string;
  itemId: string;
  projectAiContext: string;
  projectTechStack: string[];
  initialItem: unknown;
  initialSession: unknown | null;
}) {
  const [item, setItem] = useState<ItemWithSprint>(initialItem as ItemWithSprint);
  const [session, setSession] = useState<SessionWithMessages | null>(initialSession as SessionWithMessages | null);
  const [chatInput, setChatInput] = useState("");
  const [pendingChatFiles, setPendingChatFiles] = useState<File[]>([]);
  const chatAttachInputRef = useRef<HTMLInputElement | null>(null);
  const chatIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editMode, setEditMode] = useState<boolean>(() => !initialSession);
  const [needsStart, setNeedsStart] = useState<boolean>(false);
  const [startPending, setStartPending] = useState(false);
  const [startInfo, setStartInfo] = useState<{ startUserMsgId?: string; startedAt?: string; note?: string } | null>(null);
  const [startPendingSince, setStartPendingSince] = useState<number>(0);
  const [startRunToken, setStartRunToken] = useState<number>(0);
  const [err, setErr] = useState("");
  const [run, setRun] = useState<RunWithSteps | null>(null);
  const [runConnected, setRunConnected] = useState(false);
  const [promptRun, setPromptRun] = useState<RunWithSteps | null>(null);
  const [promptRunConnected, setPromptRunConnected] = useState(false);
  const [proposedCmds, setProposedCmds] = useState<string[]>([]);
  const [dismissedCmds, setDismissedCmds] = useState<string[]>([]);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdRunning, setCmdRunning] = useState(false);
  const [ticketDetailsOpen, setTicketDetailsOpen] = useState(false);
  const [ticketManagementOpen, setTicketManagementOpen] = useState(false);
  const [autoShellUntil, setAutoShellUntil] = useState<number | null>(null);
  const [clockTick, setClockTick] = useState(0);
  const [iframeChatSync, setIframeChatSync] = useState<TicketChatPostMessage | null>(null);
  const autoShellInFlight = useRef(false);
  /** Не крутить авто-ОК в цикл при ошибке одной и той же команды. */
  const lastAutoShellFailCmd = useRef<string | null>(null);

  const inSprint = Boolean(item.sprintId);

  const sprintLink = useMemo(() => {
    const n = item.sprintNumber;
    return n && n > 0 ? `/projects/${projectSlug}/sprints/${n}` : "";
  }, [item.sprintNumber, projectSlug]);

  const reload = useCallback(async () => {
    setErr("");
    const r = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}`, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      return;
    }
    setItem((j as { item: ItemWithSprint }).item);
    setSession((j as { session: SessionWithMessages | null }).session ?? null);
  }, [itemId]);

  const onTicketChatPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = collectClipboardFiles(e);
    if (files.length === 0) return;
    e.preventDefault();
    setPendingChatFiles((prev) => mergePendingFiles(prev, files));
  }, []);

  useEffect(() => {
    if (inSprint) return;
    if (!session?.id) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [inSprint, session?.id, reload]);

  const runProgress = useMemo(() => {
    const steps = run?.steps ?? [];
    const doneByDb = steps.filter((s) => s.status === "done").length;
    // Fallback: if DB step statuses lag behind, derive progress from chat headings.
    const doneByChat = (() => {
      const msgs = session?.messages ?? [];
      let max = 0;
      for (const m of msgs) {
        if (m.role !== "assistant") continue;
        const hit = (m.content ?? "").match(/^###\s*Шаг\s+(\d+)\/(\d+)/im);
        if (!hit) continue;
        const n = Number(hit[1]);
        const t = Number(hit[2]);
        if (Number.isFinite(n) && Number.isFinite(t) && t > 0) {
          max = Math.max(max, n);
        }
      }
      return max;
    })();
    const total = steps.length || 0;
    return { done: Math.min(total, Math.max(doneByDb, doneByChat)), total };
  }, [run?.steps, session?.messages]);

  const renderSteps = useMemo(() => {
    const steps = run?.steps ?? [];
    return steps.map((s, idx) => {
      if (s.status === "done" || s.status === "failed" || s.status === "cancelled") return s;
      if (runProgress.done > idx) return { ...s, status: "done" as const };
      return s;
    });
  }, [run?.steps, runProgress.done]);

  const WAITING_CODE = "[***waiting for answer***]";
  const lastAssistantContent = useMemo(() => {
    const msgs = session?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === "assistant") return msgs[i]!.content ?? "";
    }
    return "";
  }, [session?.messages]);

  const parsedCmds = useMemo(() => {
    const text = String(lastAssistantContent ?? "");
    const out: string[] = [];
    const re = /<<<SHELL_COMMAND>>>([\s\S]*?)<<<\/SHELL_COMMAND>>>/g;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(text))) {
      const cmd = (m[1] ?? "").trim();
      if (cmd) out.push(cmd);
    }
    return out;
  }, [lastAssistantContent]);
  const approvalCmds = useMemo(() => {
    const merged = [...proposedCmds, ...parsedCmds].map((c) => c.trim()).filter(Boolean);
    const uniq: string[] = [];
    for (const c of merged) {
      if (dismissedCmds.includes(c)) continue;
      if (!uniq.includes(c)) uniq.push(c);
    }
    return uniq;
  }, [dismissedCmds, parsedCmds, proposedCmds]);
  const waitingByCodeWord = lastAssistantContent.includes(WAITING_CODE);
  const waitingByHeuristic =
    /\?\s*$/.test(lastAssistantContent.trim()) ||
    /\b(уточните|уточнение|ответьте|ответ|подтвердите|выберите|нужно уточнить|как лучше|какой вариант|предпочитаете)\b/i.test(lastAssistantContent);
  const agentWaiting = waitingByCodeWord || waitingByHeuristic;
  const lastCommandFailed = looksLikeCommandFailure(lastAssistantContent ?? "");

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string } | null;
      if (!d || d.type !== CHAT_POST_MESSAGE_TYPE) return;
      setIframeChatSync(d as TicketChatPostMessage);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const sessionDerivedPresence = useMemo((): ChatAgentPresence => {
    const msgs = session?.messages ?? [];
    if (msgs.length === 0) return "idle";
    const last = msgs[msgs.length - 1]!;
    if (last.role === "user") return "thinking";
    if (looksLikeAssistantBusy(last.content ?? "")) {
      const age = Date.now() - new Date((last as { createdAt: string | Date }).createdAt).getTime();
      // If heartbeat (updatedAt) is fresh (< 3 min), agent is alive regardless of message age
      const heartbeatAge = session?.updatedAt
        ? Date.now() - new Date(session.updatedAt as string | Date).getTime()
        : Infinity;
      if (heartbeatAge < 3 * 60 * 1000) return "thinking";
      // No fresh heartbeat — treat as stale after 10 min
      if (age > 10 * 60 * 1000) return "idle";
      return "thinking";
    }
    if (looksLikeCommandFailure(last.content ?? "")) return "error";
    if (looksLikeAssistantFailure(last.content ?? "")) return "error";
    if ((last.content ?? "").trimStart().startsWith("🕵️ Аудитор:")) return "auditing";
    return "idle";
  }, [session?.messages, session?.updatedAt]);

  const agentPresence = useMemo((): ChatAgentPresence => {
    if (session?.isStopped) return "idle";
    if (run?.status === "failed") return "error";
    const orchBusy =
      startPending || (run && (run.status === "running" || run.status === "queued"));
    if (orchBusy) return "thinking";
    if (loadingChat || cmdRunning) return "thinking";
    if (generating && promptRun && (promptRun.status === "running" || promptRun.status === "queued")) return "thinking";
    if (iframeChatSync) {
      if (iframeChatSync.loading) return "thinking";
      if (iframeChatSync.err?.trim()) return "error";
      return iframeChatSync.chatAgentPresence;
    }
    return sessionDerivedPresence;
  }, [session?.isStopped, run, startPending, loadingChat, cmdRunning, generating, promptRun, iframeChatSync, sessionDerivedPresence]);

  const agentPresenceTitle = useMemo(() => {
    switch (agentPresence) {
      case "thinking":
        return "Думаю — агент обрабатывает сообщение; дождитесь ответа в ленте выше.";
      case "auditing":
        return "Аудитор проверяет вывод и при необходимости отправляет исполнителю уточнённый контекст.";
      case "error":
        return "Похоже на сбой ответа или процесса. Обычно нового вывода без ваших действий не будет — проверьте текст и при необходимости перезапустите агента.";
      default:
        return "Ответ уже в ленте; автоматически нового сообщения сейчас не ожидается. Если агент задал вопрос — ответьте в поле ниже.";
    }
  }, [agentPresence]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTO_SHELL_UNTIL_KEY);
      if (!raw) return;
      const t = parseInt(raw, 10);
      if (Number.isNaN(t) || t < Date.now()) {
        localStorage.removeItem(AUTO_SHELL_UNTIL_KEY);
        return;
      }
      setAutoShellUntil(t);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (autoShellUntil !== null && autoShellUntil < Date.now()) {
      localStorage.removeItem(AUTO_SHELL_UNTIL_KEY);
      setAutoShellUntil(null);
    }
  }, [autoShellUntil, clockTick]);

  useEffect(() => {
    // New assistant message may contain new approval requests.
    setDismissedCmds([]);
    lastAutoShellFailCmd.current = null;
  }, [lastAssistantContent]);

  async function save(patch: Partial<BacklogItem> & { sprintId?: string | null }) {
    setSaving(true);
    setErr("");
    try {
      const r = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      await reload();
      setEditMode(false);
      setNeedsStart(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function startWork(forceClick = false) {
    if (startPending && !forceClick) {
      setStartInfo((prev) => prev ?? { note: "⏳ Уже запущено. Ждём ответ…" });
      return;
    }
    setErr("");
    setStartPending(true);
    setStartPendingSince(Date.now());
    const myToken = startRunToken + 1;
    setStartRunToken(myToken);
    setStartInfo({ note: "⏳ Отправляю сигнал агенту…" });
    const force = needsStart || editMode || forceClick;
    const r = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}/start${force ? "?force=1" : ""}`, {
      method: "POST",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      setStartPending(false);
      return;
    }
    setSession((j as { session: SessionWithMessages }).session);
    const runId = (j as { runId?: string }).runId;
    const runObj = (j as { run?: RunWithSteps }).run;
    if (runObj) setRun(runObj);
    await reload();
    setEditMode(false);
    setNeedsStart(false);

    const startUserMsgId = (j as { startUserMsgId?: string }).startUserMsgId;
    const startedAt = (j as { startedAt?: string }).startedAt;
    const orchPhases = runObj?.steps?.length;
    setStartInfo({
      startUserMsgId,
      startedAt,
      note:
        typeof orchPhases === "number"
          ? `⏳ Агент запущен: ${orchPhases} шагов; прогресс — в чеклисте и в чате…`
          : "⏳ Агент думает…",
    });

    if (runId) {
      setRunConnected(false);
      try {
        const es = new EventSource(`/api/agent-runs/${encodeURIComponent(runId)}/stream`);
        es.addEventListener("snapshot", (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as { run?: RunWithSteps };
            if (data.run) setRun(data.run);
            setRunConnected(true);
          } catch {
            // ignore
          }
        });
        es.addEventListener("run", (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as { run?: RunWithSteps };
            if (data.run) setRun(data.run);
            setRunConnected(true);
          } catch {
            // ignore
          }
        });
        es.addEventListener("error", () => {
          setRunConnected(false);
        });
        // Close on completion
        es.addEventListener("event", (ev) => {
          try {
            const e = JSON.parse((ev as MessageEvent).data) as { type?: string; data?: unknown };
            if (e.type === "cmd_proposed") {
              const d = e.data as { commands?: unknown } | null;
              const cmds = Array.isArray(d?.commands) ? (d?.commands as string[]) : [];
              if (cmds.length) setProposedCmds(cmds.map((c) => String(c)));
            }
            if (e.type === "done" || e.type === "failed" || e.type === "waiting_user") {
              es.close();
            }
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
    }

    // Legacy polling: keep as fallback for chat messages.
    if (startUserMsgId) {
      const deadline = Date.now() + 1_920_000;
      const poll = async () => {
        if (startRunToken !== myToken) return;
        if (Date.now() > deadline) {
          setStartPending(false);
          setStartInfo((prev) =>
            prev ? { ...prev, note: "Долго нет ответа. Нажмите «Повторить запуск», если нужно." } : prev
          );
          return;
        }
        await reload();
        const cur = (await (async () => {
          const r2 = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}`, { credentials: "include" });
          const j2 = await r2.json().catch(() => ({}));
          if (!r2.ok) return null;
          return (j2 as { session?: SessionWithMessages | null }).session ?? null;
        })()) as SessionWithMessages | null;
        const msgs = cur?.messages ?? [];
        const idx = msgs.findIndex((m) => m.id === startUserMsgId);
        const assistantsAfter = idx >= 0 ? msgs.slice(idx + 1).filter((m) => m.role === "assistant") : [];
        const waitingNow = assistantsAfter.some((m) => {
          const t = (m.content ?? "").trim();
          if (!t) return false;
          if (t.includes(WAITING_CODE)) return true;
          return (
            /\?\s*$/.test(t) ||
            /\b(уточните|уточнение|ответьте|ответ|подтвердите|выберите|нужно уточнить|как лучше|какой вариант|предпочитаете)\b/i.test(t)
          );
        });
        const legacyDone = assistantsAfter.length > 0;
        if (waitingNow) {
          setStartPending(false);
          setStartInfo((prev) =>
            prev
              ? { ...prev, note: "⏳ Агент ждёт ответа. Дождитесь вопроса и ответьте в чате." }
              : prev
          );
          return;
        }
        if (legacyDone) {
          setStartPending(false);
          setStartInfo((prev) =>
            prev
              ? {
                  ...prev,
                  note: "✅ Ответ агента получен (см. чат).",
                }
              : prev
          );
          return;
        }
        setTimeout(() => void poll(), 2000);
      };
      setTimeout(() => void poll(), 1200);
    } else {
      // No correlation id; still allow UI to proceed.
      setTimeout(() => setStartPending(false), 2500);
    }
  }

  async function stopOrchestrator() {
    if (!session?.id) return;
    setErr("");
    try {
      const r = await fetch(`/api/project/chat-sessions/${encodeURIComponent(session.id)}/stop`, {
        method: "POST",
        credentials: "include",
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; stopped?: boolean; message?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStartPending(false);
      setStartInfo((prev) =>
        prev
          ? {
              ...prev,
              note: j.stopped ? "Процесс остановлен." : (j.message ?? "Запрос обработан."),
            }
          : { note: j.stopped ? "Процесс остановлен." : (j.message ?? "Запрос обработан.") }
      );
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const execCommand = useCallback(
    async (command: string) => {
      const cmd = command.trim();
      if (!cmd) return;
      if (!run?.id && !session?.id) {
        setErr("Нет сессии чата для выполнения команды (откройте чат с агентом).");
        return;
      }
      setCmdRunning(true);
      setErr("");
      try {
        let r: Response;
        if (run?.id) {
          r = await fetch(`/api/agent-runs/${encodeURIComponent(run.id)}/exec`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: cmd }),
          });
        } else {
          r = await fetch(`/api/project/chat-sessions/${encodeURIComponent(session!.id)}/exec`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: cmd }),
          });
        }
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setCmdInput("");
        setProposedCmds((prev) => prev.filter((c) => c.trim() !== cmd));
        setDismissedCmds((prev) => [...prev, cmd]);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        try {
          const raw = localStorage.getItem(AUTO_SHELL_UNTIL_KEY);
          const t = raw ? parseInt(raw, 10) : 0;
          if (t > Date.now()) lastAutoShellFailCmd.current = cmd;
        } catch {
          /* ignore */
        }
      } finally {
        setCmdRunning(false);
      }
    },
    [run?.id, session?.id, reload]
  );

  const autoShellValid = autoShellUntil !== null && Date.now() < autoShellUntil;

  useEffect(() => {
    if (inSprint || !autoShellValid || cmdRunning || approvalCmds.length === 0) return;
    if (!run?.id && !session?.id) return;
    if (autoShellInFlight.current) return;
    const cmd = approvalCmds[0];
    if (cmd === lastAutoShellFailCmd.current) return;
    autoShellInFlight.current = true;
    void execCommand(cmd).finally(() => {
      autoShellInFlight.current = false;
    });
  }, [approvalCmds, autoShellValid, cmdRunning, execCommand, inSprint, run?.id, session?.id]);

  async function togglePause() {
    setErr("");
    const path = item.isPaused ? "resume" : "pause";
    const r = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}/${path}`, {
      method: "POST",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      return;
    }
    setItem((j as { item: ItemWithSprint }).item);
    await reload();
  }

  async function addToSprint() {
    const raw = prompt("Номер спринта (положительное число):", String(item.sprintNumber > 0 ? item.sprintNumber : 1));
    if (raw === null) return;
    const n = parseInt(raw.trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
      alert("Нужно положительное число");
      return;
    }
    const r = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}/add-to-sprint`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sprintNumber: n, sprintStatus: item.sprintStatus || "forming" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      return;
    }
    await reload();
  }

  async function sendToAgent() {
    if ((!chatInput.trim() && pendingChatFiles.length === 0) || !session?.id) return;
    flushSync(() => {
      setLoadingChat(true);
      setErr("");
    });
    try {
      const raw = chatInput.trim();
      setChatInput("");
      const tr = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}`, { credentials: "include" });
      const tj = await tr.json().catch(() => ({}));
      const latestItem = (tj as { item?: ItemWithSprint }).item;
      const ticket = latestItem ?? item;
      if (latestItem) setItem(latestItem);
      const priorUserCount = (session.messages ?? []).filter((m) => m.role === "user").length;
      const refresh = userRequestedTicketContextRefresh(raw);
      const body = stripTicketContextRefreshTag(raw) || raw;
      const key = ticket.ticketKey?.trim() || ticket.id;
      const message =
        priorUserCount === 0 || refresh
          ? buildFullTicketContextText({
              ticketKeyOrId: key,
              title: ticket.title,
              description: ticket.description,
              descriptionPrompt: ticket.descriptionPrompt,
              userMessage: body,
            })
          : buildFollowUpTicketUserPayload(body);
      let r: Response;
      const validFiles = pendingChatFiles.filter((f) => f.size > 0);
      if (validFiles.length > 0) {
        const fd = new FormData();
        fd.set("projectSlug", projectSlug);
        fd.set("sessionId", session.id);
        fd.set("message", message);
        for (const f of validFiles) fd.append("files", f, f.name);
        r = await fetch("/api/agent/chat", { method: "POST", credentials: "include", body: fd });
      } else {
        r = await fetch("/api/agent/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectSlug, sessionId: session.id, message }),
        });
      }
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        userMsg?: { id: string };
        timeoutMs?: number;
      };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPendingChatFiles([]);
      try {
        chatIframeRef.current?.contentWindow?.postMessage(
          { type: CHAT_SCROLL_TO_BOTTOM_TYPE },
          window.location.origin
        );
      } catch {
        /* ignore */
      }
      void reload();
      if (!inSprint && j.userMsg?.id) {
        setStartInfo((prev) => ({
          ...(prev || {}),
          note: "Сообщение принято; агент отвечает в фоне. Уведомление — в колокольчике справа вверху.",
        }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingChat(false);
    }
  }

  async function generateEngineeringPrompt() {
    setGenerating(true);
    setErr("");
    try {
      setItem((prev) => ({
        ...prev,
        descriptionPrompt: prev.descriptionPrompt?.trim()
          ? prev.descriptionPrompt
          : "Генерирую инженерный промпт…",
      }));
      const r = await fetch(`/api/project/backlog/${encodeURIComponent(itemId)}/generate-engineering-prompt`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt:
            `Ты ведущий промпт-инженер для создания решений в стеке технологий ${projectTechStack.join(", ") || "(не указан)"}.\\n` +
            `Контекст проекта: ${projectAiContext || "(пусто)"}\\n\\n` +
            `Тебя просят реализовать такой функционал. Напиши подробный промпт для этого задания для передачи агенту Cursor CLI.`,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; runId?: string; run?: RunWithSteps };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (j.run) setPromptRun(j.run);

      const runId = j.runId;
      if (runId) {
        setPromptRunConnected(false);
        const es = new EventSource(`/api/agent-runs/${encodeURIComponent(runId)}/stream`);
        es.addEventListener("snapshot", (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as { run?: RunWithSteps };
            if (data.run) setPromptRun(data.run);
            setPromptRunConnected(true);
          } catch {
            // ignore
          }
        });
        es.addEventListener("run", (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as { run?: RunWithSteps };
            if (data.run) setPromptRun(data.run);
            setPromptRunConnected(true);
          } catch {
            // ignore
          }
        });
        es.addEventListener("event", (ev) => {
          try {
            const e = JSON.parse((ev as MessageEvent).data) as { type?: string };
            if (e.type === "done" || e.type === "failed") {
              es.close();
              void reload();
            }
          } catch {
            // ignore
          }
        });
        es.addEventListener("error", () => setPromptRunConnected(false));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      alert(msg);
    } finally {
      setGenerating(false);
    }
  }

  const chatIframeSrc =
    session?.id && !inSprint
      ? `/projects/${encodeURIComponent(projectSlug)}/backlog/${encodeURIComponent(itemId)}/chat?sessionId=${encodeURIComponent(session.id)}&embed=thread`
      : "";

  const ticketTopSection = (
    <div className="space-y-2 px-2 py-2 sm:px-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 pt-0.5">
              <span className="font-mono text-xs text-blue-300">{ticketIdLabel(item)}</span>
              {item.isPaused && <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">paused</span>}
              {inSprint && (
                <span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-[10px] text-emerald-300">sprint #{item.sprintNumber}</span>
              )}
            </div>
            <textarea
              className="min-h-[1.75rem] max-h-32 flex-1 resize-y border-0 bg-transparent px-0 py-0.5 text-base font-semibold leading-snug text-white outline-none ring-0 placeholder:text-slate-600 focus:ring-0 disabled:opacity-60"
              value={item.title}
              maxLength={200}
              rows={1}
              onChange={(e) => setItem({ ...item, title: e.target.value })}
              disabled={!editMode}
              placeholder="Заголовок тикета"
            />
          </div>

          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/40">
            <button
              type="button"
              className="flex w-full touch-manipulation items-center justify-between gap-3 px-3 py-3 text-left sm:py-2.5"
              onClick={() => setTicketManagementOpen((o) => !o)}
              aria-expanded={ticketManagementOpen}
              id="ticket-management-toggle"
            >
              <span className="text-sm font-medium text-slate-200">Управление</span>
              <span
                className={`inline-flex size-8 shrink-0 items-center justify-center rounded border border-slate-700 text-xs text-slate-400 transition-transform duration-200 sm:size-7 ${
                  ticketManagementOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              >
                ▼
              </span>
            </button>
            {ticketManagementOpen ? (
              <div
                className="space-y-3 border-t border-slate-800 px-3 pb-4 pt-3"
                role="region"
                aria-labelledby="ticket-management-toggle"
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900/40"
                    onClick={() => {
                      setEditMode(true);
                      setNeedsStart(true);
                    }}
                    disabled={inSprint}
                    title={inSprint ? "Редактирование в спринте ограничено" : "Разблокировать поля и подготовить тикет к запуску"}
                  >
                    Редактировать тикет
                  </button>
                  <button
                    type="button"
                    className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                    disabled={saving}
                    onClick={() => void save({ title: item.title, description: item.description, descriptionPrompt: item.descriptionPrompt })}
                  >
                    Сохранить (ждать запуска)
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900/40"
                    onClick={() => void togglePause()}
                  >
                    {item.isPaused ? "Продолжить" : "Запарковать"}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900/40 disabled:opacity-50"
                    disabled={inSprint}
                    onClick={() => void addToSprint()}
                    title={inSprint ? "Тикет уже в спринте" : "Добавить тикет в спринт"}
                  >
                    Включить в спринт
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900/40 disabled:opacity-50"
                    disabled={inSprint || startPending || agentWaiting}
                    onClick={() => void startWork(false)}
                    title={
                      inSprint
                        ? "Работа идёт в рамках спринта"
                        : agentWaiting
                          ? "Агент ждёт вашего ответа. Нажмите «Отправить» в поле чата."
                          : "Создать/открыть чат с агентом под тикетом"
                    }
                  >
                    {agentWaiting ? "Агент ждёт ответа" : startPending ? "Агент думает…" : needsStart ? "Запустить в работу" : "Перезапустить агента"}
                  </button>
                  {startPending && Date.now() - startPendingSince > 30000 && !inSprint && !agentWaiting && (
                    <button
                      type="button"
                      className="rounded border border-amber-900/60 px-3 py-2 text-sm text-amber-200 hover:bg-amber-900/10"
                      onClick={() => void startWork(true)}
                      title="Повторно отправить контекст и перезапустить агента"
                    >
                      Повторить запуск
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40">
          <button
            type="button"
            className="flex w-full touch-manipulation items-center justify-between gap-3 px-3 py-3 text-left sm:py-2.5"
            onClick={() => setTicketDetailsOpen((o) => !o)}
            aria-expanded={ticketDetailsOpen}
            id="ticket-details-toggle"
          >
            <span className="text-sm font-medium text-slate-200">Детали</span>
            <span
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded border border-slate-700 text-xs text-slate-400 transition-transform duration-200 sm:size-7 ${
                ticketDetailsOpen ? "rotate-180" : ""
              }`}
              aria-hidden
            >
              ▼
            </span>
          </button>
          {ticketDetailsOpen ? (
            <div className="space-y-4 border-t border-slate-800 px-3 pb-4 pt-3" role="region" aria-labelledby="ticket-details-toggle">
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-500">Status</span>
                  <select
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-200"
                    value={item.status}
                    onChange={(e) => setItem({ ...item, status: e.target.value })}
                  >
                    {BACKLOG_ITEM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-500">Priority</span>
                  <select
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-200"
                    value={item.priority}
                    onChange={(e) => setItem({ ...item, priority: parseInt(e.target.value, 10) })}
                  >
                    {[1, 2, 3, 4, 5].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-500">Sprint status</span>
                  <select
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-200"
                    value={item.sprintStatus}
                    onChange={(e) => setItem({ ...item, sprintStatus: e.target.value })}
                  >
                    {BACKLOG_SPRINT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900/40 disabled:opacity-50"
                  disabled={saving}
                  onClick={() => void save({ status: item.status, priority: item.priority, sprintStatus: item.sprintStatus })}
                >
                  Применить статус/приоритет
                </button>
                {inSprint && sprintLink && (
                  <Link className="rounded border border-emerald-900 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-900/20" href={sprintLink}>
                    Открыть спринт #{item.sprintNumber}
                  </Link>
                )}
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">Описание</div>
                    <button
                      type="button"
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900/40 disabled:opacity-50"
                      disabled={generating}
                      onClick={() => void generateEngineeringPrompt()}
                      title="Сгенерировать подробный инженерный промпт и сохранить в поле промпта/ТЗ"
                    >
                      {generating ? "…" : "Создать инженерный промпт"}
                    </button>
                  </div>
                  {promptRun && (
                    <div className="mt-2 rounded border border-slate-800 bg-black/20 p-2 text-xs text-slate-300">
                      <div className="flex items-center justify-between gap-2">
                        <span>Генерация промпта</span>
                        <span className="font-mono text-slate-400">{promptRunConnected ? "live" : "…"}</span>
                      </div>
                      <div className="mt-2 space-y-1">
                        {(promptRun.steps ?? []).map((s) => (
                          <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-black/10 px-2 py-1">
                            <span className="text-slate-200">{s.title}</span>
                            <span className={s.status === "done" ? "text-emerald-300" : s.status === "running" ? "text-amber-200" : s.status === "failed" ? "text-red-300" : "text-slate-400"}>
                              {s.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <textarea
                    className="mt-1 min-h-[140px] w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                    value={item.description ?? ""}
                    onChange={(e) => setItem({ ...item, description: e.target.value || null })}
                    placeholder="Описание (необязательно)"
                    disabled={!editMode}
                  />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Промпт / ТЗ для агента</div>
                  <textarea
                    className="mt-1 min-h-[140px] w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
                    value={item.descriptionPrompt ?? ""}
                    onChange={(e) => setItem({ ...item, descriptionPrompt: e.target.value })}
                    placeholder="Промпт…"
                    disabled={!editMode}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {needsStart && !inSprint && (
          <div className="mt-3 rounded border border-amber-900/60 bg-amber-900/10 p-3 text-xs text-amber-200">
            Тикет в режиме редактирования/ожидания. Нажмите “Запустить в работу”, чтобы агент прочитал актуальные поля.
          </div>
        )}

        {startInfo?.note && !inSprint && (
          <div className="mt-3 rounded border border-slate-800 bg-black/20 p-3 text-xs text-slate-300">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 align-middle" />
            {startInfo.note}
          </div>
        )}

        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
    </div>
  );

  const chatMiddleSection =
    !inSprint && session?.id ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-x border-slate-800 bg-black/20">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 px-2 py-1.5">
          <span className="text-sm font-medium text-white">Чат с агентом</span>
          {session?.isStopped ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-700/50 bg-red-950/50 px-2 py-0.5 text-[10px] text-red-200">
              <span className="size-1 rounded-full bg-red-400" aria-hidden />
              Остановлен
            </span>
          ) : agentWaiting ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/50 bg-amber-950/50 px-2 py-0.5 text-[10px] text-amber-100">
              <span className="size-1 animate-pulse rounded-full bg-amber-400" aria-hidden />
              Ждёт ответа
            </span>
          ) : agentPresence === "thinking" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-700/50 bg-blue-950/50 px-2 py-0.5 text-[10px] text-blue-200">
              <span className="size-1 animate-pulse rounded-full bg-blue-400" aria-hidden />
              Думает…
            </span>
          ) : null}
          {session?.updatedAt && agentPresence === "thinking" && !session.isStopped ? (
            <span className="text-[10px] text-slate-500" title="Последний пульс от агента">
              пульс: {new Date(session.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          ) : null}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500">
            <input
              type="checkbox"
              className="size-3.5 accent-amber-600"
              checked={autoShellValid}
              onChange={(e) => {
                if (e.target.checked) {
                  const until = Date.now() + AUTO_SHELL_MS;
                  localStorage.setItem(AUTO_SHELL_UNTIL_KEY, String(until));
                  setAutoShellUntil(until);
                  lastAutoShellFailCmd.current = null;
                } else {
                  localStorage.removeItem(AUTO_SHELL_UNTIL_KEY);
                  setAutoShellUntil(null);
                }
              }}
            />
            Авто-ОК shell 2ч
          </label>
        </div>
        {run ? (
          <div className="max-h-[min(200px,30svh)] shrink-0 overflow-y-auto border-b border-slate-800 px-2 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
              <span>Чеклист</span>
              <span className="font-mono text-slate-300">
                {runProgress.done}/{runProgress.total}
                {runConnected ? " · live" : ""}
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              {renderSteps.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-slate-800/80 bg-black/10 px-1.5 py-0.5 text-[10px]">
                  <span className="truncate text-slate-200">{s.title}</span>
                  <span
                    className={
                      s.status === "done"
                        ? "text-emerald-300"
                        : s.status === "running"
                          ? "text-amber-200"
                          : s.status === "failed"
                            ? "text-red-300"
                            : "text-slate-400"
                    }
                  >
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-950">
          <div className="sr-only" role="status" aria-live="polite">
            {agentPresenceTitle}
          </div>
          <iframe
            ref={chatIframeRef}
            className="h-full w-full touch-manipulation border-0"
            src={chatIframeSrc}
            title="Ticket chat"
          />
          <button
            type="button"
            className="pointer-events-auto absolute bottom-1.5 right-[17px] z-10 flex size-[22px] shrink-0 items-center justify-center rounded border border-red-800/80 bg-red-950/85 text-red-200 shadow-sm hover:bg-red-900/80 disabled:opacity-30"
            disabled={!session?.id || session.isStopped === true}
            onClick={() => void stopOrchestrator()}
            title={session?.isStopped ? "Агент уже остановлен. Нажмите «Перезапустить агента» для возобновления." : "Остановить фонового оркестратора (после «Запустить в работу»). Сообщения из поля ввода ниже не отменяет."}
            aria-label="Остановить работу агента"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-[14px]" aria-hidden>
              <path d="M6 6h12v12H6V6z" />
            </svg>
          </button>
        </div>
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden border-x border-slate-800 bg-black/20 px-4 text-center text-sm text-slate-500">
        {inSprint ? (
          <>
            Чат отключён — тикет в спринте.
            {sprintLink ? (
              <>
                {" "}
                <Link href={sprintLink} className="text-blue-400 hover:underline">
                  Открыть спринт
                </Link>
              </>
            ) : null}
          </>
        ) : (
          "Пока нет чата. В «Управление» нажмите «Запустить в работу»."
        )}
      </div>
    );

  const chatBottomSection =
    !inSprint && session?.id ? (
      <section className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-t border-slate-800 bg-slate-950/98">
        <div className="flex min-h-0 min-w-0 flex-col">
          {(approvalCmds.length > 0 || run?.status === "waiting_user") && (
            <div className="max-h-[min(280px,42svh)] shrink-0 overflow-y-auto border-b border-slate-800/80 px-2 py-1.5 overscroll-contain">
              <div className="rounded border border-amber-900/60 bg-amber-900/10 p-2">
                <div className="text-[11px] font-medium text-amber-200">Подтверждение команды</div>
                {approvalCmds.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {approvalCmds.map((c, idx) => (
                      <div key={idx} className="rounded border border-slate-800 bg-black/20 p-2">
                        <pre className="max-h-20 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-slate-200">{c}</pre>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
                            disabled={cmdRunning}
                            onClick={() => void execCommand(c)}
                          >
                            ОК
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
                            disabled={cmdRunning}
                            onClick={() => setDismissedCmds((prev) => [...prev, c])}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                    value={cmdInput}
                    onChange={(e) => setCmdInput(e.target.value)}
                    placeholder="bash -lc …"
                    disabled={cmdRunning}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
                    disabled={cmdRunning || !cmdInput.trim()}
                    onClick={() => void execCommand(cmdInput)}
                  >
                    ОК
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex min-h-0 flex-col px-2 py-1.5">
            {lastCommandFailed ? (
              <div className="mb-2 shrink-0 rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 text-[11px] text-red-200">
                Последняя команда завершилась ошибкой (exit_code ≠ 0). Агент должен продолжать исправлять до успеха.
              </div>
            ) : null}
            {session?.isStopped ? (
              <div className="mb-1 shrink-0 rounded border border-amber-900/60 bg-amber-900/10 px-2 py-1.5 text-[11px] text-amber-200">
                Сессия остановлена. Нажмите «Перезапустить агента» в разделе «Управление», чтобы возобновить работу.
              </div>
            ) : null}
            <p className="mb-1 shrink-0 text-[10px] leading-snug text-slate-500">
              Первое сообщение — полный контекст тикета; дальше только ваш текст. Тег{" "}
              <span className="font-mono text-slate-400">[обновить контекст]</span> — снова отправить поля. Скрепка и{" "}
              <span className="font-mono text-slate-400">Ctrl+V</span> — вложения (до {CHAT_ATTACHMENT_MAX_FILES} файлов)
              в workspace для агента.
            </p>
            <input
              ref={chatAttachInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : [];
                setPendingChatFiles((prev) => [...prev, ...list].slice(0, CHAT_ATTACHMENT_MAX_FILES));
                e.target.value = "";
              }}
            />
            {pendingChatFiles.length > 0 ? (
              <div className="mb-1 flex max-h-16 flex-wrap gap-1 overflow-y-auto text-[10px]">
                {pendingChatFiles.map((f, i) => (
                  <span
                    key={`${f.name}-${f.size}-${i}`}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${f.size === 0 ? "border-red-700/60 bg-red-950/40 text-red-300" : "border-slate-700 bg-slate-900 text-slate-300"}`}
                    title={f.size === 0 ? "Файл пустой — не будет отправлен" : `${f.name} · ${fmtFileSize(f.size)}`}
                  >
                    {f.size === 0 ? "⚠ " : "📎 "}{f.name}
                    <span className="text-slate-600">{fmtFileSize(f.size)}</span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-red-300"
                      aria-label="Убрать файл"
                      onClick={() => setPendingChatFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 gap-2">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                <textarea
                  className="min-h-0 min-w-0 w-full flex-1 resize-none rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-60"
                  placeholder={session?.isStopped ? "Сессия остановлена — перезапустите агента" : "Сообщение агенту…"}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onPaste={onTicketChatPaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendToAgent();
                    }
                  }}
                  disabled={loadingChat || !session?.id || session.isStopped === true}
                />
                <ChatPaperclipAttach
                  className="pointer-events-auto absolute bottom-1 right-1 z-10"
                  disabled={
                    loadingChat || !session?.id || pendingChatFiles.length >= CHAT_ATTACHMENT_MAX_FILES
                  }
                  onPickFiles={() => chatAttachInputRef.current?.click()}
                />
              </div>
              <div className="flex shrink-0 flex-col items-end justify-end gap-1.5">
                <div className="leading-none" aria-hidden>
                  <img
                    key={`${agentPresence}-${TICKET_AGENT_STATUS_VER}`}
                    src={TICKET_AGENT_STATUS_SRC[agentPresence]}
                    alt=""
                    width={TICKET_AGENT_STATUS_IMG_PX}
                    height={TICKET_AGENT_STATUS_IMG_PX}
                    className="pointer-events-none w-auto max-w-[min(170px,48vw)] select-none object-contain object-bottom"
                    style={{ height: TICKET_AGENT_STATUS_IMG_PX, maxHeight: TICKET_AGENT_STATUS_IMG_PX }}
                    decoding="async"
                    loading="eager"
                  />
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  disabled={
                    loadingChat || !session?.id || session.isStopped === true || (!chatInput.trim() && pendingChatFiles.length === 0)
                  }
                  onClick={() => void sendToAgent()}
                >
                  {loadingChat ? "…" : "Отправить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    ) : (
      <section className="min-h-[4rem] shrink-0 border-t border-slate-800 bg-slate-950/90" />
    );

  return (
    <div className="h-full max-w-full min-h-0 w-full [-webkit-tap-highlight-color:transparent]">
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
        <section className="max-h-[min(46vh,560px)] shrink-0 overflow-y-auto overflow-x-hidden border-b border-slate-800 overscroll-contain">
          {ticketTopSection}
        </section>
        {chatMiddleSection}
        {chatBottomSection}
      </div>
    </div>
  );
}


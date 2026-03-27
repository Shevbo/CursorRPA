"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BacklogItem, ChatMessage, ChatSession, Sprint } from "@prisma/client";
import { BACKLOG_ITEM_STATUSES, BACKLOG_SPRINT_STATUSES } from "@/lib/backlog-constants";
import { waitForAssistantAfterUserMessage } from "@/lib/wait-agent-reply";
import type { AgentRun, AgentRunStep } from "@prisma/client";

type SessionWithMessages = ChatSession & { messages: ChatMessage[] };
type ItemWithSprint = BacklogItem & { sprint?: Sprint | null };

type RunWithSteps = AgentRun & { steps: AgentRunStep[] };

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
  const clockSide = agentWaiting ? "user" : "agent";

  const [agentClockSec, setAgentClockSec] = useState(0);
  const [userClockSec, setUserClockSec] = useState(0);

  useEffect(() => {
    setAgentClockSec(0);
    setUserClockSec(0);
  }, [startInfo?.startUserMsgId]);

  useEffect(() => {
    if (inSprint) return;
    if (!session?.id) return;
    const t = setInterval(() => {
      if (clockSide === "agent") setAgentClockSec((s) => s + 1);
      else setUserClockSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [clockSide, inSprint, session?.id]);

  useEffect(() => {
    // New assistant message may contain new approval requests.
    setDismissedCmds([]);
  }, [lastAssistantContent]);

  function formatClock(totalSeconds: number) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

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
          ? `⏳ Агент запущен: ${orchPhases} шагов; прогресс будет в чеклисте и в ленте…`
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
                  note: "✅ Ответ агента получен (см. ленту).",
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
          : prev
      );
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function execCommand(command: string) {
    if (!run?.id) return;
    const cmd = command.trim();
    if (!cmd) return;
    setCmdRunning(true);
    setErr("");
    try {
      const r = await fetch(`/api/agent-runs/${encodeURIComponent(run.id)}/exec`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setCmdInput("");
      setProposedCmds((prev) => prev.filter((c) => c.trim() !== cmd));
      setDismissedCmds((prev) => [...prev, cmd]);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCmdRunning(false);
    }
  }

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
    if (!chatInput.trim() || !session?.id) return;
    setLoadingChat(true);
    setErr("");
    try {
      const msg = chatInput.trim();
      setChatInput("");
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sessionId: session.id, message: msg }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        userMsg?: { id: string };
        timeoutMs?: number;
      };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const uid = j.userMsg?.id;
      if (uid) {
        const t = (j.timeoutMs ?? 1_800_000) + 120_000;
        await waitForAssistantAfterUserMessage(session.id, uid, { timeoutMs: t });
      }
      await reload();
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

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <div className="space-y-3">
          <div>
            <div className="text-xs text-slate-500">Ticket</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div className="font-mono text-sm text-blue-300">{ticketIdLabel(item)}</div>
              {item.isPaused && <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">paused</span>}
              {inSprint && (
                <span className="rounded bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-300">
                  in sprint #{item.sprintNumber}
                </span>
              )}
            </div>
            <textarea
              className="mt-3 min-h-[4.5rem] w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-lg font-semibold text-white"
              value={item.title}
              maxLength={200}
              rows={2}
              onChange={(e) => setItem({ ...item, title: e.target.value })}
              disabled={!editMode}
            />
            <div className="mt-1 text-xs text-slate-500">{Math.min(200, item.title?.length ?? 0)}/200</div>
          </div>

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
                    : "Создать/открыть ленту агента под тикетом"
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

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
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

        <div className="mt-3 flex flex-wrap gap-2">
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

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
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

        {agentWaiting && !inSprint && (
          <div className="mt-3 rounded border border-amber-900/60 bg-amber-900/10 p-3 text-xs text-amber-200">
            ⏳ Агент ждёт вашего ответа. Отвечать нужно в поле ввода чата ниже.
          </div>
        )}

        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
      </div>

      <div className="rounded-xl border border-slate-800 bg-black/20">
        <div className="border-b border-slate-800 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-white">Лента под тикетом</div>
            <div className="flex items-center gap-2 text-[11px]">
              <div
                className={`rounded border px-2 py-1 ${
                  clockSide === "agent"
                    ? "animate-pulse border-amber-700/60 bg-amber-950/30 text-amber-200"
                    : "border-slate-700 bg-slate-900/20 text-slate-300"
                }`}
              >
                Агент {formatClock(agentClockSec)}
              </div>
              <div
                className={`rounded border px-2 py-1 ${
                  clockSide === "user"
                    ? "animate-pulse border-amber-700/60 bg-amber-950/30 text-amber-200"
                    : "border-slate-700 bg-slate-900/20 text-slate-300"
                }`}
              >
                Вы {formatClock(userClockSec)}
              </div>
            </div>
          </div>
          {inSprint ? (
            <div className="mt-1 text-xs text-slate-500">
              Этот тикет реализуется в рамках спринта. Перейдите в спринт для работы с агентом.
              {sprintLink && (
                <>
                  {" "}
                  <Link href={sprintLink} className="text-blue-400 hover:underline">
                    Открыть спринт
                  </Link>
                  .
                </>
              )}
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-500">Весь диалог с агентом сохраняется здесь (ChatMessage в БД).</div>
          )}
        </div>
        {!inSprint && session?.id ? (
          <div>
            {run && (
              <div className="border-b border-slate-800 px-3 py-3">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span>Чеклист (как Cursor)</span>
                  <span className="font-mono text-slate-300">
                    {runProgress.done}/{runProgress.total} {runConnected ? "· live" : "· …"}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {renderSteps.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-black/10 px-2 py-1 text-xs">
                      <span className="text-slate-200">{s.title}</span>
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
            )}
            <div className="h-[38vh] min-h-[260px]">
              <iframe
                className="h-full w-full"
                src={`/projects/${encodeURIComponent(projectSlug)}/backlog/${encodeURIComponent(itemId)}/chat?sessionId=${encodeURIComponent(session.id)}`}
                title="Ticket chat"
              />
            </div>
            <div className="space-y-2 border-t border-slate-800 px-3 py-3">
              {(approvalCmds.length > 0 || run?.status === "waiting_user") && (
                <div className="rounded border border-amber-900/60 bg-amber-900/10 p-3">
                  <div className="text-xs font-medium text-amber-200">Требуется подтверждение команды</div>
                  <div className="mt-1 text-[11px] leading-snug text-amber-200/80">
                    Агент запросил согласование. Подтвердите команду кнопкой “ОК” или отклоните “Отмена”.
                  </div>

                  {approvalCmds.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {approvalCmds.map((c, idx) => (
                        <div key={idx} className="rounded border border-slate-800 bg-black/20 p-2">
                          <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-200">{c}</pre>
                          <div className="mt-2 flex gap-2">
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

                  <div className="mt-3">
                    <div className="text-[11px] text-slate-400">Или выполните любую команду вручную (с подтверждением):</div>
                    <div className="mt-2 flex gap-2">
                      <input
                        className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200"
                        value={cmdInput}
                        onChange={(e) => setCmdInput(e.target.value)}
                        placeholder="bash -lc …"
                        disabled={cmdRunning}
                      />
                      <button
                        type="button"
                        className="rounded bg-amber-600 px-3 py-2 text-xs font-medium text-black disabled:opacity-50"
                        disabled={cmdRunning || !cmdInput.trim()}
                        onClick={() => void execCommand(cmdInput)}
                      >
                        ОК
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span>Прогресс (после последнего запуска)</span>
                <span className="font-mono text-slate-300">
                  {runProgress.done}/{runProgress.total}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-[width] duration-500"
                  style={{
                    width: `${runProgress.total ? Math.min(100, (100 * runProgress.done) / runProgress.total) : 0}%`,
                  }}
                />
              </div>
              <button
                type="button"
                className="w-full rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200 hover:bg-red-950/50 disabled:opacity-40"
                onClick={() => void stopOrchestrator()}
              >
                Остановить работу агента
              </button>
              <p className="text-[11px] leading-snug text-slate-500">
                Прерывает фоновый процесс оркестратора на сервере (после «Запустить в работу»). Отдельные сообщения из поля чата этой кнопкой не отменяются.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 text-sm text-slate-500">
            {inSprint ? "Чат тикета отключён — работа ведётся в рамках спринта." : "Пока нет ленты. Нажмите “Запустить сразу в работу”."}
          </div>
        )}
      </div>
    </div>
  );
}


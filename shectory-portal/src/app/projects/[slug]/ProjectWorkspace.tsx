"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ChatSession } from "@prisma/client";
import { BacklogPanel } from "@/components/BacklogPanel";
import { fetchChatSession, waitForAssistantAfterUserMessage } from "@/lib/wait-agent-reply";

type SessionWithMessages = ChatSession & { messages: ChatMessage[] };
type TestCase = { id: string; title: string; status: string; kind: string; scope: string; module?: { name: string } | null };
type DeployEnvironment = {
  id: string;
  name: string;
  status: string;
  branch: string;
  targetHost?: string | null;
  directory?: string | null;
  isProd: boolean;
};
type BotStatus = {
  projectSlug: string;
  unitName: string;
  configured: boolean;
  hasToken: boolean;
  allowedUserIds: string;
  activeState: string;
  enabledState: string;
  lastError?: string;
};
type WelcomeStatus = {
  artifacts?: { mainFrameBrief?: string };
  missing?: string[];
  user?: { email?: string; role?: string } | null;
};

export function ProjectWorkspace({
  projectSlug,
  projectId,
  workspacePath,
  initialSessions,
  className = "",
}: {
  projectSlug: string;
  projectId: string;
  workspacePath: string;
  initialSessions: SessionWithMessages[];
  className?: string;
}) {
  const [tab, setTab] = useState<"files" | "terminal" | "chat" | "backlog" | "tests" | "deploy" | "bot">("chat");
  const [sessions, setSessions] = useState(initialSessions);
  const [activeId, setActiveId] = useState(initialSessions[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<string>("");
  const [tests, setTests] = useState<TestCase[]>([]);
  const [deployEnvs, setDeployEnvs] = useState<DeployEnvironment[]>([]);
  const [newTestTitle, setNewTestTitle] = useState("");
  const [newTestModule, setNewTestModule] = useState("");
  const [newEnv, setNewEnv] = useState("");
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [botAllowedIds, setBotAllowedIds] = useState("");
  const [cmdInput, setCmdInput] = useState("");
  const [cmdRunning, setCmdRunning] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [welcomeLoading, setWelcomeLoading] = useState(false);
  const [welcomeErr, setWelcomeErr] = useState("");
  const [mainFrameBrief, setMainFrameBrief] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const active = useMemo(
    () => sessions.find((s) => s.id === activeId),
    [sessions, activeId]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages, activeId, loading, tab]);

  const proposedCmds = useMemo(() => {
    const lastAssistant = [...(active?.messages ?? [])].reverse().find((m) => m.role === "assistant");
    const text = String(lastAssistant?.content ?? "");
    const out: string[] = [];
    const re = /<<<SHELL_COMMAND>>>([\s\S]*?)<<<\/SHELL_COMMAND>>>/g;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(text))) {
      const cmd = (m[1] ?? "").trim();
      if (cmd) out.push(cmd);
    }
    return out;
  }, [active?.messages]);

  const loadTree = useCallback(async () => {
    const r = await fetch(`/api/workspace/tree?projectId=${projectId}`, {
      credentials: "include",
    });
    const j = await r.json();
    setTree(j.output ?? j.error ?? "");
  }, [projectId]);

  const loadTests = useCallback(async () => {
    const r = await fetch(`/api/project/tests?projectId=${projectId}`, { credentials: "include" });
    const j = await r.json();
    setTests(j.testCases ?? []);
  }, [projectId]);

  const loadDeploy = useCallback(async () => {
    const r = await fetch(`/api/project/deploy?projectId=${projectId}`, { credentials: "include" });
    const j = await r.json();
    setDeployEnvs(j.environments ?? []);
  }, [projectId]);

  const loadBotStatus = useCallback(async () => {
    const r = await fetch(`/api/project/bot?projectId=${projectId}`, { credentials: "include" });
    const j = await r.json();
    setBotStatus(j.status ?? null);
    if (j.status?.allowedUserIds) setBotAllowedIds(j.status.allowedUserIds);
  }, [projectId]);

  const send = async () => {
    if (!input.trim() || !activeId) return;
    setLoading(true);
    const sent = input.trim();
    setInput("");
    try {
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sessionId: activeId,
          message: sent,
        }),
      });
      const j = (await r.json()) as {
        error?: string;
        userMsg?: ChatMessage;
        timeoutMs?: number;
      };
      if (!r.ok) throw new Error(j.error ?? "request failed");
      const userMsg = j.userMsg;
      if (!userMsg?.id) throw new Error("Нет userMsg в ответе API");
      setSessions((prev) =>
        prev.map((s) => (s.id === activeId ? { ...s, messages: [...s.messages, userMsg] } : s))
      );
      const t = (j.timeoutMs ?? 1_800_000) + 120_000;
      const wait = await waitForAssistantAfterUserMessage(activeId, userMsg.id, { timeoutMs: t });
      const fresh = await fetchChatSession(activeId);
      if (fresh) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeId
              ? {
                  ...s,
                  messages: fresh.messages.map(
                    (m) =>
                      ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                        createdAt: new Date(m.createdAt),
                        sessionId: activeId,
                      }) as ChatMessage
                  ),
                }
              : s
          )
        );
      }
      if (!wait.done && wait.timedOut) {
        alert("Ответ агента ещё не пришёл за отведённое время. Откройте вкладку снова или подождите.");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const execCommand = async (command: string) => {
    if (!activeId || !command.trim()) return;
    if (!confirm(`Выполнить команду на сервере?\n\n${command.trim()}`)) return;
    setCmdRunning(true);
    try {
      const r = await fetch(`/api/project/chat-sessions/${encodeURIComponent(activeId)}/exec`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: command.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      const fresh = await fetchChatSession(activeId);
      if (fresh) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeId
              ? {
                  ...s,
                  messages: fresh.messages.map(
                    (msg) =>
                      ({
                        id: msg.id,
                        role: msg.role,
                        content: msg.content,
                        createdAt: new Date(msg.createdAt),
                        sessionId: activeId,
                      }) as ChatMessage
                  ),
                }
              : s
          )
        );
      }
      setCmdInput("");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCmdRunning(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/welcome-artifacts`, {
          credentials: "include",
        });
        if (!r.ok) return;
        const j = (await r.json()) as WelcomeStatus;
        if (cancelled) return;
        const email = String(j.user?.email ?? "").toLowerCase();
        const mustOpen = email === "bshevelev@mail.ru" && Array.isArray(j.missing) && j.missing.length > 0;
        setMainFrameBrief(String(j.artifacts?.mainFrameBrief ?? ""));
        setWelcomeOpen(mustOpen);
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  const saveWelcomeArtifacts = async () => {
    setWelcomeLoading(true);
    setWelcomeErr("");
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/welcome-artifacts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mainFrameBrief: mainFrameBrief.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? "Не удалось сохранить");
      setWelcomeOpen(false);
    } catch (e) {
      setWelcomeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWelcomeLoading(false);
    }
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`.trim()}>
      <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-800 bg-slate-950 py-2">
        {(["chat", "files", "backlog", "tests", "deploy", "bot", "terminal"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              if (t === "files") void loadTree();
              if (t === "tests") void loadTests();
              if (t === "deploy") void loadDeploy();
              if (t === "bot") void loadBotStatus();
            }}
            className={`rounded px-4 py-2 text-sm font-medium ${
              tab === t ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {t === "chat"
              ? "Чаты"
              : t === "files"
              ? "Файлы"
              : t === "backlog"
              ? "Бэклог"
              : t === "tests"
              ? "Тест-кейсы"
              : t === "deploy"
              ? "Деплой/среды"
              : t === "bot"
              ? "Статус ТГ бота"
              : "Терминал"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "chat" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row lg:gap-3">
            <div className="w-full shrink-0 lg:w-48">
              <div className="text-xs text-slate-500">Сессии</div>
              <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto lg:max-h-none">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(s.id)}
                      className={`w-full rounded px-2 py-1 text-left text-sm ${
                        s.id === activeId ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-slate-800 bg-black/20">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 text-sm">
                {active?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.role === "user" ? "ml-8 rounded-lg bg-blue-900/30 p-3" : "mr-8 rounded-lg bg-slate-800/50 p-3"
                    }
                  >
                    <div className="text-xs text-slate-500">{m.role}</div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-200">{m.content}</pre>
                  </div>
                ))}
                <div ref={messagesEndRef} className="h-px shrink-0" aria-hidden />
              </div>
              {(proposedCmds.length > 0 || cmdInput.trim()) && (
              <div className="shrink-0 border-t border-slate-800 bg-amber-950/20 p-3 text-sm">
                <div className="mb-2 text-xs text-amber-200/80">
                  Агент предложил терминальные команды. Выполнение только после вашего подтверждения.
                </div>
                <div className="space-y-2">
                  {proposedCmds.map((cmd, i) => (
                    <div key={`${cmd}-${i}`} className="rounded border border-amber-900/50 bg-black/30 p-2">
                      <pre className="whitespace-pre-wrap text-xs text-amber-100">{cmd}</pre>
                      <button
                        type="button"
                        className="mt-2 rounded bg-amber-600 px-3 py-1 text-xs text-white disabled:opacity-60"
                        disabled={cmdRunning}
                        onClick={() => void execCommand(cmd)}
                      >
                        {cmdRunning ? "..." : "Выполнить"}
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      placeholder="Или введите команду вручную…"
                      value={cmdInput}
                      onChange={(e) => setCmdInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                      disabled={cmdRunning || !cmdInput.trim()}
                      onClick={() => void execCommand(cmdInput)}
                    >
                      {cmdRunning ? "..." : "Выполнить"}
                    </button>
                  </div>
                </div>
              </div>
              )}
              <div className="shrink-0 border-t border-slate-800 bg-slate-950/80 p-2">
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                    placeholder="Сообщение агенту Cursor (выполняется agent CLI на сервере)…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void send()}
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {loading ? "…" : "Отправить"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "files" && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <pre className="min-h-[12rem] rounded-lg border border-slate-800 bg-black/40 p-4 text-xs text-green-400">
              {tree || "Нажмите вкладку ещё раз или откройте Files — загрузка дерева…"}
            </pre>
          </div>
        )}

        {tab === "backlog" && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-slate-800 bg-black/20 p-4">
            <BacklogPanel projectId={projectId} projectSlug={projectSlug} variant="embedded" />
          </div>
        )}

        {tab === "tests" && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-slate-800 bg-black/20 p-4">
          <div className="grid gap-2 lg:grid-cols-3">
            <input
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              placeholder="Название теста"
              value={newTestTitle}
              onChange={(e) => setNewTestTitle(e.target.value)}
            />
            <input
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              placeholder="Модуль (optional)"
              value={newTestModule}
              onChange={(e) => setNewTestModule(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
              onClick={async () => {
                if (!newTestTitle.trim()) return;
                let r = await fetch("/api/project/tests", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    projectId,
                    title: newTestTitle.trim(),
                    moduleName: newTestModule.trim() || undefined,
                    description: "Создано из оркестратора",
                  }),
                });
                if (!r.ok) {
                  const j = await r.json().catch(() => ({}));
                  if ((j as { code?: string }).code === "ticket_prefix_required" && r.status === 409) {
                    const raw = prompt("Нужен префикс проекта (латиница A-Z, 1..5 символов, заглавными). Например: PH", "");
                    if (!raw) return;
                    const pr = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/prefix`, {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ticketPrefix: raw }),
                    });
                    if (!pr.ok) {
                      const pj = await pr.json().catch(() => ({}));
                      alert((pj as { error?: string }).error ?? "Не удалось сохранить префикс");
                      return;
                    }
                    r = await fetch("/api/project/tests", {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId,
                        title: newTestTitle.trim(),
                        moduleName: newTestModule.trim() || undefined,
                        description: "Создано из оркестратора",
                      }),
                    });
                    if (!r.ok) {
                      const j2 = await r.json().catch(() => ({}));
                      alert((j2 as { error?: string }).error ?? "Ошибка создания теста");
                      return;
                    }
                  } else {
                    alert((j as { error?: string }).error ?? "Ошибка создания теста");
                    return;
                  }
                }
                setNewTestTitle("");
                setNewTestModule("");
                await loadTests();
              }}
            >
              Добавить тест
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {tests.map((t) => (
              <li key={t.id} className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="font-medium text-slate-200">{t.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {(t as unknown as { caseKey?: string | null }).caseKey ? (
                    <span className="font-mono text-slate-300">{(t as unknown as { caseKey?: string | null }).caseKey}</span>
                  ) : (
                    <span className="font-mono text-slate-600">{t.id.slice(0, 8)}</span>
                  )}{" "}
                  · module: {t.module?.name ?? "-"} · kind: {t.kind} · scope: {t.scope} · status: {t.status}
                </div>
              </li>
            ))}
          </ul>
          </div>
        )}

        {tab === "deploy" && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-slate-800 bg-black/20 p-4">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              placeholder="Новая среда (например test1)"
              value={newEnv}
              onChange={(e) => setNewEnv(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
              onClick={async () => {
                if (!newEnv.trim()) return;
                await fetch("/api/project/deploy", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ projectId, name: newEnv.trim(), branch: "main" }),
                });
                setNewEnv("");
                await loadDeploy();
              }}
            >
              Добавить среду
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {deployEnvs.map((d) => (
              <li key={d.id} className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="font-medium text-slate-200">{d.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  status: {d.status} · branch: {d.branch} {d.isProd ? "· PROD" : ""}
                </div>
                {(d.targetHost || d.directory) && (
                  <div className="mt-1 text-xs text-slate-500">
                    {d.targetHost ? `host: ${d.targetHost}` : ""} {d.directory ? `dir: ${d.directory}` : ""}
                  </div>
                )}
              </li>
            ))}
          </ul>
          </div>
        )}

        {tab === "bot" && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-slate-800 bg-black/20 p-4">
          <div className="rounded border border-slate-800 bg-slate-900/40 p-3 text-sm">
            <div className="text-slate-200">
              unit: <span className="text-slate-400">{botStatus?.unitName ?? "(нет данных)"}</span>
            </div>
            <div className="mt-1 text-slate-300">
              active: <span className="text-slate-400">{botStatus?.activeState ?? "unknown"}</span> · enabled:{" "}
              <span className="text-slate-400">{botStatus?.enabledState ?? "unknown"}</span>
            </div>
            <div className="mt-1 text-slate-300">
              configured: <span className="text-slate-400">{String(botStatus?.configured ?? false)}</span> · token:{" "}
              <span className="text-slate-400">{botStatus?.hasToken ? "set" : "missing"}</span>
            </div>
            {botStatus?.lastError && <div className="mt-1 text-xs text-red-400">{botStatus.lastError}</div>}
          </div>
          <div className="grid gap-2 lg:grid-cols-3">
            <input
              type="password"
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              placeholder="Telegram bot token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
            <input
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              placeholder="Allowed user IDs (comma-separated)"
              value={botAllowedIds}
              onChange={(e) => setBotAllowedIds(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
              onClick={async () => {
                if (!botToken.trim() || !botAllowedIds.trim()) {
                  alert("Нужны bot token и allowed user ids");
                  return;
                }
                const r = await fetch("/api/project/bot", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    projectId,
                    token: botToken.trim(),
                    allowedUserIds: botAllowedIds.trim(),
                  }),
                });
                const j = await r.json();
                if (!r.ok) {
                  alert(j.error ?? "failed");
                  return;
                }
                setBotToken("");
                setBotStatus(j.status ?? null);
                alert("ТГ-бот запущен/обновлён");
              }}
            >
              Запустить/обновить бота
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Для каждого проекта создаётся отдельный systemd user unit и отдельный env с токеном/аудиторией.
          </p>
          </div>
        )}

        {tab === "terminal" && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-slate-800 bg-black/40 p-4 text-sm text-slate-300">
            <p>Веб-терминал не встроён (безопасность). Используйте SSH на Shectory:</p>
            <pre className="mt-2 text-green-400">ssh shectory-work</pre>
            <p className="mt-2 text-slate-500">Рабочий каталог проекта:</p>
            <pre className="text-slate-200">{workspacePath}</pre>
          </div>
        )}
      </div>
      {welcomeOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-950 p-5">
            <h3 className="text-lg font-semibold text-white">Сбор артефактов welcome-экрана</h3>
            <p className="mt-1 text-sm text-slate-400">
              Для стандарта Shectory заполните описание основного фрейма welcome-экрана.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300">
                Что должно быть в основном фрейме welcome-экрана
                <textarea
                  className="mt-1 min-h-28 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  value={mainFrameBrief}
                  onChange={(e) => setMainFrameBrief(e.target.value)}
                />
              </label>
              {welcomeErr && <div className="text-sm text-red-400">{welcomeErr}</div>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={welcomeLoading}
                  onClick={() => setWelcomeOpen(false)}
                  className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-200 disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={welcomeLoading || !mainFrameBrief.trim()}
                  onClick={() => void saveWelcomeArtifacts()}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {welcomeLoading ? "Сохраняю..." : "Сохранить и продолжить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

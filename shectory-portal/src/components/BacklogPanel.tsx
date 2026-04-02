"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BACKLOG_ITEM_STATUSES, BACKLOG_SPRINT_STATUSES } from "@/lib/backlog-constants";

export type BacklogRow = {
  id: string;
  ticketKey?: string | null;
  ticketSeq?: number | null;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  orderNum: number | null;
  sprintNumber: number;
  sprintStatus: string;
  sprintId?: string | null;
  isPaused?: boolean;
  descriptionPrompt: string;
  taskType: string | null;
  modules: string | null;
  components: string | null;
  complexity: number | null;
  docLink: string | null;
  testOrderOrLink: string | null;
  createdAt: string;
  updatedAt: string;
};

export function BacklogPanel({
  projectId,
  projectSlug,
  variant = "control",
}: {
  projectId: string;
  projectSlug: string;
  variant?: "control" | "embedded";
}) {
  const [items, setItems] = useState<BacklogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [statusFilter, setStatusFilter] = useState("");
  const [sprintFilter, setSprintFilter] = useState("");
  const [taskTypeFilter, setTaskTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newSprint, setNewSprint] = useState("0");
  const [newSprintStatus, setNewSprintStatus] = useState("forming");
  const [newPriority, setNewPriority] = useState(3);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const sp = new URLSearchParams({
        projectId,
        page: String(page),
        limit: String(limit),
        sortBy,
        sortDir,
      });
      if (statusFilter) sp.set("status", statusFilter);
      if (sprintFilter !== "") sp.set("sprintNumber", sprintFilter);
      if (taskTypeFilter.trim()) sp.set("taskType", taskTypeFilter.trim());
      const r = await fetch(`/api/project/backlog?${sp}`, { credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setItems(j.items ?? []);
      setTotal(j.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, page, limit, statusFilter, sprintFilter, taskTypeFilter, sortBy, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm("Удалить задачу из бэклога?")) return;
    const r = await fetch(`/api/project/backlog/${id}`, { method: "DELETE", credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert((j as { error?: string }).error ?? "Ошибка удаления");
      return;
    }
    await load();
  }

  async function addItem() {
    if (!newTitle.trim()) return;
    let r = await fetch("/api/project/backlog", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        descriptionPrompt: newPrompt.trim(),
        sprintNumber: parseInt(newSprint, 10) || 0,
        sprintStatus: newSprintStatus,
        priority: newPriority,
      }),
    });
    let j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if ((j as { code?: string }).code === "ticket_prefix_required" && r.status === 409) {
        const raw = prompt("Нужен префикс проекта (латиница A-Z, 1..5 символов, заглавными). Например: PH", "");
        if (!raw) return;
        const pr = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/prefix`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketPrefix: raw }),
        });
        const pj = await pr.json().catch(() => ({}));
        if (!pr.ok) {
          alert((pj as { error?: string }).error ?? "Не удалось сохранить префикс");
          return;
        }
        // retry create
        r = await fetch("/api/project/backlog", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            title: newTitle.trim(),
            description: newDescription.trim() || undefined,
            descriptionPrompt: newPrompt.trim(),
            sprintNumber: parseInt(newSprint, 10) || 0,
            sprintStatus: newSprintStatus,
            priority: newPriority,
          }),
        });
        j = await r.json().catch(() => ({}));
        if (!r.ok) {
          alert((j as { error?: string }).error ?? "Ошибка создания");
          return;
        }
      } else {
        alert((j as { error?: string }).error ?? "Ошибка создания");
        return;
      }
    }
    setNewTitle("");
    setNewDescription("");
    setNewPrompt("");
    setNewSprint("0");
    setNewSprintStatus("forming");
    setNewPriority(3);
    setPage(1);
    await load();
  }

  function idLabel(b: BacklogRow) {
    return (b.ticketKey && String(b.ticketKey)) || b.id.slice(0, 8);
  }

  function fmtDate(s: string) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString();
  }

  return (
    <div className="space-y-4">
      {variant === "embedded" && (
        <p className="text-sm text-slate-400">
          Расширенная панель:{" "}
          <Link href={`/projects/${projectSlug}/control`} className="text-blue-400 hover:underline">
            Панель управления → бэклог
          </Link>
        </p>
      )}

      {variant === "control" && (
        <p className="text-sm text-slate-400">
          Остальные разделы проекта — на{" "}
          <Link href={`/projects/${projectSlug}`} className="text-blue-400 hover:underline">
            карточке проекта
          </Link>
          .
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-3 text-sm [&_select]:min-h-[44px] [&_input]:min-h-[44px] sm:[&_select]:min-h-0 sm:[&_input]:min-h-0">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Статус</span>
          <select
            className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-200"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">Все</option>
            {BACKLOG_ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Спринт #</span>
          <input
            className="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-200"
            placeholder="—"
            value={sprintFilter}
            onChange={(e) => {
              setPage(1);
              setSprintFilter(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">taskType</span>
          <input
            className="w-28 rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-200"
            value={taskTypeFilter}
            onChange={(e) => {
              setPage(1);
              setTaskTypeFilter(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Сортировка</span>
          <select
            className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-200"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="priority">priority</option>
            <option value="createdAt">createdAt</option>
            <option value="updatedAt">updatedAt</option>
            <option value="sprintNumber">sprintNumber</option>
            <option value="statusChangedAt">statusChangedAt</option>
            <option value="orderNum">orderNum</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Порядок</span>
          <select
            className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-200"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
          >
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[44px] rounded border border-slate-600 px-3 py-1.5 text-slate-300 hover:bg-slate-800 sm:min-h-0"
        >
          Обновить
        </button>
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {loading && <p className="text-xs text-slate-500">Загрузка…</p>}

      <div className="rounded-lg border border-slate-800 bg-black/20 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">Новая задача</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-2"
            placeholder="Заголовок *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <input
            type="number"
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            placeholder="Спринт #"
            value={newSprint}
            onChange={(e) => setNewSprint(e.target.value)}
          />
          <select
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            value={newSprintStatus}
            onChange={(e) => setNewSprintStatus(e.target.value)}
          >
            {BACKLOG_SPRINT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            value={newPriority}
            onChange={(e) => setNewPriority(parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                priority {p}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          placeholder="Описание (необязательно)"
          rows={2}
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
        />
        <textarea
          className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          placeholder="Промпт / ТЗ для агента (необязательно)"
          rows={3}
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 min-h-[44px] rounded bg-blue-600 px-4 py-2 text-sm text-white sm:min-h-0"
          onClick={() => void addItem()}
        >
          Добавить в бэклог
        </button>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-800 bg-black/20">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-950/90 text-xs uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-800">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Sprint</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((b) => (
              <tr key={b.id} className="hover:bg-slate-900/40">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  <Link
                    href={`/projects/${projectSlug}/backlog/${b.id}`}
                    className="text-blue-400 hover:underline"
                    title="Открыть тикет"
                  >
                    {idLabel(b)}
                  </Link>
                  {b.isPaused && <span className="ml-2 rounded bg-amber-900/40 px-2 py-0.5 text-[11px] text-amber-300">paused</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-100">{b.title}</div>
                      {b.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{b.description}</div>}
                    </div>
                    <Link
                      href={`/projects/${projectSlug}/backlog/${b.id}`}
                      className="shrink-0 rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
                      title="Открыть тикет и редактировать"
                      aria-label="Редактировать тикет"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="size-4"
                        aria-hidden
                      >
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </Link>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{b.status}</span>
                </td>
                <td className="px-3 py-2 text-slate-300">p{b.priority}</td>
                <td className="px-3 py-2 text-slate-400">
                  {b.sprintId || b.sprintNumber > 0 ? (
                    <span>
                      #{b.sprintNumber} <span className="text-xs text-slate-600">({b.sprintStatus})</span>
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtDate(b.updatedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                  <button
                    type="button"
                    className="text-red-400 hover:underline"
                    onClick={() => void remove(b.id)}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-slate-500" colSpan={7}>
                  Нет задач по текущим фильтрам
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <button
            type="button"
            disabled={page <= 1}
            className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Назад
          </button>
          <span>
            Стр. {page} из {Math.ceil(total / limit)} ({total} задач)
          </span>
          <button
            type="button"
            disabled={page >= Math.ceil(total / limit)}
            className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40"
            onClick={() => setPage((p) => p + 1)}
          >
            Вперёд
          </button>
        </div>
      )}
    </div>
  );
}

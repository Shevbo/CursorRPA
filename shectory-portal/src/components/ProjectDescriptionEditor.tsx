"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Props = {
  slug: string;
  initialDescription: string;
  canEdit: boolean;
  /** compact — карточка на главной; full — страница проекта */
  variant: "compact" | "full";
};

export function ProjectDescriptionEditor({ slug, initialDescription, canEdit, variant }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!editing) setText(initialDescription);
  }, [initialDescription, editing]);

  if (!canEdit) {
    if (variant === "compact") {
      return <p className="mt-2 line-clamp-3 text-sm text-slate-400">{initialDescription}</p>;
    }
    return <p className="text-slate-300">{initialDescription}</p>;
  }

  async function save() {
    setErr("");
    setSaving(true);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description: text }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setText(initialDescription);
    setEditing(false);
    setErr("");
  }

  const taClass =
    variant === "compact"
      ? "min-h-[4.5rem] w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
      : "min-h-[8rem] w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200";

  if (editing) {
    return (
      <div className={variant === "compact" ? "mt-2" : "mt-1"} onClick={(e) => e.preventDefault()}>
        <textarea
          className={taClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
          aria-label="Описание проекта"
        />
        {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? "…" : "Сохранить"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={cancel}
            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            Отмена
          </button>
        </div>
      </div>
    );
  }

  const preview =
    variant === "compact" ? (
      <p className="mt-2 line-clamp-3 text-sm text-slate-400">{initialDescription}</p>
    ) : (
      <p className="whitespace-pre-wrap text-slate-300">{initialDescription}</p>
    );

  return (
    <div className={variant === "compact" ? "mt-2" : ""}>
      <div className={variant === "compact" ? "flex items-start justify-between gap-2" : ""}>
        {variant === "compact" ? (
          <p className="line-clamp-3 flex-1 text-sm text-slate-400">{initialDescription}</p>
        ) : (
          <p className="whitespace-pre-wrap text-slate-300">{initialDescription}</p>
        )}
        {variant === "compact" && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setText(initialDescription);
              setEditing(true);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-800 hover:text-blue-400"
            title="Редактировать описание"
          >
            ✎
          </button>
        )}
      </div>
      {variant === "full" && (
        <button
          type="button"
          onClick={() => {
            setText(initialDescription);
            setEditing(true);
          }}
          className="mt-2 text-sm text-blue-400 hover:underline"
        >
          Редактировать описание
        </button>
      )}
    </div>
  );
}

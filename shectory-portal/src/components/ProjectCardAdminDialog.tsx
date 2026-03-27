"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  slug: string;
  name: string;
  description: string;
  uiUrl: string | null;
  stage: string;
  registryMetaJson: unknown;
};

type CardMeta = {
  projectLogo?: string;
  generatedOverviewUrl?: string;
};

function readCardMeta(meta: unknown): CardMeta {
  const root = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  const card = (root.projectCard && typeof root.projectCard === "object"
    ? root.projectCard
    : {}) as Record<string, unknown>;
  return {
    projectLogo: typeof card.projectLogo === "string" ? card.projectLogo : "",
    generatedOverviewUrl: typeof card.generatedOverviewUrl === "string" ? card.generatedOverviewUrl : "",
  };
}

export function ProjectCardAdminDialog({
  projects,
  autoOpen,
}: {
  projects: Item[];
  autoOpen: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [idx, setIdx] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectLogo, setProjectLogo] = useState("");
  const [overviewUrl, setOverviewUrl] = useState("");
  const [uiUrl, setUiUrl] = useState("");
  const [stage, setStage] = useState("dev");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const cur = projects[idx];
  const currentMeta = useMemo(() => readCardMeta(cur?.registryMetaJson), [cur?.registryMetaJson]);

  useEffect(() => {
    if (!cur) return;
    setName(cur.name ?? "");
    setDescription(cur.description ?? "");
    setProjectLogo(currentMeta.projectLogo ?? "");
    setOverviewUrl(currentMeta.generatedOverviewUrl ?? "");
    setUiUrl(cur.uiUrl ?? "");
    setStage((cur.stage || "dev").toLowerCase());
    setErr("");
  }, [cur, currentMeta.generatedOverviewUrl, currentMeta.projectLogo]);

  if (!open || !cur) return null;

  async function saveCurrent() {
    setErr("");
    const d = description.trim();
    if (d.length < 50 || d.length > 300) {
      setErr("Описание должно быть от 50 до 300 символов");
      return false;
    }
    setSaving(true);
    try {
      const mergedMeta = {
        ...((cur.registryMetaJson && typeof cur.registryMetaJson === "object" ? cur.registryMetaJson : {}) as Record<string, unknown>),
        projectCard: {
          ...readCardMeta(cur.registryMetaJson),
          projectLogo: projectLogo.trim(),
          generatedOverviewUrl: overviewUrl.trim(),
        },
      };
      const r = await fetch(`/api/projects/${encodeURIComponent(cur.slug)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: d,
          uiUrl: uiUrl.trim() || null,
          stage,
          registryMetaJson: mergedMeta,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? "Не удалось сохранить карточку");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    const ok = await saveCurrent();
    if (!ok) return;
    if (idx >= projects.length - 1) {
      setOpen(false);
      window.location.reload();
      return;
    }
    setIdx((v) => v + 1);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-950 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Обновление карточек проектов</h3>
          <div className="text-xs text-slate-400">
            {idx + 1}/{projects.length}
          </div>
        </div>
        <p className="mb-4 text-sm text-slate-400">Актуализируйте метаданные карточек проектов.</p>

        <div className="space-y-3">
          <label className="block text-sm text-slate-300">
            1) Название проекта
            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="block text-sm text-slate-300">
            1) Лого проекта (URL/путь/описание)
            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white" value={projectLogo} onChange={(e) => setProjectLogo(e.target.value)} />
          </label>

          <label className="block text-sm text-slate-300">
            2) Описание (50-300)
            <textarea className="mt-1 min-h-24 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="mt-1 text-xs text-slate-500">{description.trim().length} символов</div>
          </label>

          <label className="block text-sm text-slate-300">
            3) Ссылка на описательную часть (агент/аудит)
            <div className="mt-1 flex gap-2">
              <input className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white" value={overviewUrl} onChange={(e) => setOverviewUrl(e.target.value)} />
              <button
                type="button"
                className="rounded bg-amber-600 px-3 py-2 text-xs font-medium text-white"
                onClick={() => setOverviewUrl(`${window.location.origin}/api/projects/${encodeURIComponent(cur.slug)}/handoff`)}
              >
                Обновить описание агентом
              </button>
            </div>
          </label>

          <label className="block text-sm text-slate-300">
            4) Ссылка на UI проекта
            <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white" value={uiUrl} onChange={(e) => setUiUrl(e.target.value)} />
          </label>

          <label className="block text-sm text-slate-300">
            5) Статус
            <select className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-white" value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="dev">dev</option>
              <option value="mvp">mvp</option>
              <option value="prod">prod</option>
              <option value="archive">archive</option>
            </select>
          </label>
          {err && <div className="text-sm text-red-400">{err}</div>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300" onClick={() => setOpen(false)}>
            Закрыть
          </button>
          <button type="button" disabled={saving} onClick={() => void next()} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Сохраняю..." : idx >= projects.length - 1 ? "Сохранить и завершить" : "Сохранить и далее"}
          </button>
        </div>
      </div>
    </div>
  );
}


"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  canCreate: boolean;
};

export function CreateProjectButton({ canCreate }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [repoName, setRepoName] = useState("");
  const [owner, setOwner] = useState("Shevbo");
  const [maintainer, setMaintainer] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");

  if (!canCreate) return null;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          name: name.trim(),
          repoName: repoName.trim(),
          owner: owner.trim(),
          maintainer: maintainer.trim() || undefined,
          visibility,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error ?? "Не удалось создать проект");
        return;
      }
      setOpen(false);
      setSlug("");
      setName("");
      setRepoName("");
      setMaintainer("");
      router.refresh();
      const createdSlug = j?.result?.slug;
      if (typeof createdSlug === "string" && createdSlug) {
        router.push(`/projects/${createdSlug}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="grid h-11 min-h-[44px] w-11 min-w-[44px] touch-manipulation place-items-center rounded-lg border border-slate-700 bg-slate-900 text-lg font-semibold text-white hover:bg-slate-800"
        title="Добавить проект"
        onClick={() => setOpen(true)}
      >
        +
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Новый прикладной проект</div>
            <div className="grid gap-2">
              <input
                className="min-h-[44px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                placeholder="slug (например piranha-ai)"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <input
                className="min-h-[44px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                placeholder="Название проекта"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="min-h-[44px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                placeholder="repoName (например piranha-ai)"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
              />
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  className="min-h-[44px] min-w-0 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                  placeholder="owner (GitHub org/user)"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                />
                <input
                  className="min-h-[44px] min-w-0 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                  placeholder="maintainer (опционально)"
                  value={maintainer}
                  onChange={(e) => setMaintainer(e.target.value)}
                />
              </div>
              <select
                className="min-h-[44px] rounded border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value === "public" ? "public" : "private")}
              >
                <option value="private">private</option>
                <option value="public">public</option>
              </select>
            </div>

            {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="min-h-[44px] rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 touch-manipulation"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Отмена
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60 touch-manipulation"
                disabled={pending || !slug.trim() || !name.trim() || !repoName.trim() || !owner.trim()}
                onClick={submit}
              >
                {pending ? "Создаю..." : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

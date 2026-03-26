"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshArchitectureButton({ slug }: { slug?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/architecture/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slug ? { slug } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      const updated = (j as { updated?: number }).updated ?? 0;
      setMsg(`OK: обновлено ${updated}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(""), 4000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => void run()}
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-50"
      >
        {loading ? "…" : "Пересобрать архитектуру"}
      </button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </div>
  );
}


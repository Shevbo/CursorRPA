"use client";

import { useRef, useState } from "react";

export function ShectoryLogoPicker({ canUpload, sizeClass }: { canUpload: boolean; sizeClass: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [bust, setBust] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload/shectory-logo", { method: "POST", credentials: "include", body: fd });
      const raw = await r.text();
      const j = (() => {
        try {
          return JSON.parse(raw) as { error?: string; bust?: number };
        } catch {
          return null;
        }
      })();
      if (!r.ok) throw new Error(j?.error ?? `Upload failed (HTTP ${r.status})`);
      const b = Number((j as { bust?: number }).bust ?? Date.now());
      setBust(Number.isFinite(b) ? b : Date.now());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <img
        src={`/brand/shectory-logo.gif?v=${bust}`}
        alt="Shectory"
        className={`${sizeClass} w-auto ${canUpload ? "cursor-pointer" : ""} ${busy ? "opacity-60" : ""}`}
        title={canUpload ? "Кликните, чтобы заменить лого" : "Shectory"}
        onClick={() => {
          if (!canUpload || busy) return;
          inputRef.current?.click();
        }}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}


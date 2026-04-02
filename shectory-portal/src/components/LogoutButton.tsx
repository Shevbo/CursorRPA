"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      setLoading(false);
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => void logout()}
      className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50 touch-manipulation"
    >
      {loading ? "…" : "Выйти"}
    </button>
  );
}


"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("bshevelev@mail.ru");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? "Ошибка входа");
      router.push("/projects");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-slate-800 bg-slate-900/50 text-lg font-semibold text-white">
          S
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-white">Shectory</h1>
          <p className="text-sm text-slate-400">Панель управления · shectory.ru</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          type="email"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <input
          type="password"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "…" : "Войти"}
        </button>
      </form>
    </main>
  );
}

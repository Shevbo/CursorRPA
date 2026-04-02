"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Mode = "login" | "set-initial" | "register" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("bshevelev@mail.ru");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => {
    if (mode === "set-initial") return "Первичная установка пароля";
    if (mode === "register") return "Регистрация";
    if (mode === "forgot") return "Восстановление пароля";
    return "Вход";
  }, [mode]);

  async function submitLogin() {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const j = await r.json().catch(() => ({} as { error?: string; needSetPassword?: boolean }));
    if (r.status === 409 && (j as { needSetPassword?: boolean }).needSetPassword) {
      setMode("set-initial");
      setInfo("Для этого аккаунта пароль ещё не задан. Установите его.");
      return;
    }
    if (!r.ok) throw new Error((j as { error?: string }).error ?? "Ошибка входа");
    router.push("/projects");
    router.refresh();
  }

  async function submitSetInitial() {
    const r = await fetch("/api/auth/set-initial-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error ?? "Не удалось задать пароль");
    setInfo("Пароль задан. Теперь выполните вход.");
    setMode("login");
    setPassword("");
  }

  async function requestCode(kind: "register" | "forgot") {
    const url = kind === "register" ? "/api/auth/register/request-code" : "/api/auth/forgot/request-code";
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email.trim() }),
    });
    const j = await r.json().catch(() => ({} as { error?: string; debugCode?: string }));
    if (!r.ok) throw new Error((j as { error?: string }).error ?? "Не удалось отправить код");
    setInfo("Код отправлен на e-mail.");
    if (typeof (j as { debugCode?: string }).debugCode === "string") {
      setDebugCode((j as { debugCode?: string }).debugCode || "");
    } else {
      setDebugCode("");
    }
  }

  async function submitWithCode(kind: "register" | "forgot") {
    const url = kind === "register" ? "/api/auth/register/confirm" : "/api/auth/forgot/confirm";
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error ?? "Ошибка подтверждения");
    router.push("/projects");
    router.refresh();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setInfo("");
    setLoading(true);
    try {
      if (mode === "login") await submitLogin();
      else if (mode === "set-initial") await submitSetInitial();
      else if (mode === "register") await submitWithCode("register");
      else await submitWithCode("forgot");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="shrink-0">
          <img
            src="/brand/shectory-logo.gif"
            alt="Shectory"
            className="h-12 w-auto sm:h-14"
          />
        </div>
        <div className="text-right">
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-bold text-white sm:px-4 sm:py-2">PORTAL</div>
          <div className="mt-1 text-xs text-slate-500">app 0.1.0 | auth 2.0.0</div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
          <h1 className="text-xl font-semibold text-white sm:text-2xl">Информационный фрейм портала</h1>
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">
            Здесь размещается открытая визуализация состояния Shectory: проекты, статусы сред, версия модулей,
            ключевые метрики и служебные подсказки для оператора.
          </p>
        </article>
        <aside className="rounded-xl border border-slate-800 bg-black/30 p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              type="email"
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-3 text-base text-white sm:py-2 sm:text-sm"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <input
              type="password"
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-3 text-base text-white sm:py-2 sm:text-sm"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            {(mode === "register" || mode === "forgot") && (
              <input
                type="text"
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-3 text-base text-white sm:py-2 sm:text-sm"
                placeholder="Код из письма"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
            {err && <p className="text-sm text-red-400">{err}</p>}
            {info && <p className="text-sm text-emerald-300">{info}</p>}
            {debugCode && (
              <p className="text-xs text-amber-300">
                DEV код: <span className="font-mono">{debugCode}</span>
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-blue-600 py-3 text-sm font-medium text-white disabled:opacity-50 sm:py-2"
            >
              {loading ? "…" : mode === "login" ? "Войти" : mode === "set-initial" ? "Задать пароль" : "Подтвердить"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode("login")}
              className="min-h-[44px] px-2 text-blue-400 hover:underline sm:min-h-0"
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setCode("");
                setErr("");
              }}
              className="min-h-[44px] px-2 text-blue-400 hover:underline sm:min-h-0"
            >
              Регистрация
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setCode("");
                setErr("");
              }}
              className="min-h-[44px] px-2 text-blue-400 hover:underline sm:min-h-0"
            >
              Забыли пароль
            </button>
          </div>
          {(mode === "register" || mode === "forgot") && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void requestCode(mode === "register" ? "register" : "forgot")}
              className="mt-3 min-h-[44px] px-2 text-xs text-amber-300 hover:underline disabled:opacity-50 sm:min-h-0"
            >
              Отправить код на e-mail
            </button>
          )}
        </aside>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PORTAL_USER_ROLES } from "@/lib/portal-settings-registry";

type SettingRow = {
  key: string;
  value: string;
  label: string;
  description: string;
  group: string;
  isSecret: boolean;
  secretSet: boolean;
  enumValues?: string[];
};

type UserRow = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  fullName: string;
};

type Provider = {
  id: string;
  name: string;
  label: string;
  baseUrl: string | null;
  apiKeyRef: string | null;
  enabled: boolean;
  icon: string | null;
};

type GlobalModelEntry = {
  id: string;
  projectId: string;
  providerId: string;
  modelId: string;
  label: string;
  isDefault: boolean;
  weight: number;
  useProxy: boolean;
  project: { slug: string; name: string };
  provider: { id: string; name: string; label: string; icon: string | null };
};

type ApiKeyEntry = {
  providerId: string;
  providerName: string;
  providerLabel: string;
  settingKey: string;
  isSet: boolean;
};

const MODEL_PRESETS: Record<string, Array<{ modelId: string; label: string }>> = {
  openai: [
    { modelId: "gpt-4o", label: "GPT-4o" },
    { modelId: "gpt-4o-mini", label: "GPT-4o Mini" },
    { modelId: "gpt-4o-realtime-preview", label: "GPT-4o Realtime Preview" },
    { modelId: "gpt-4o-audio-preview", label: "GPT-4o Audio Preview" },
    { modelId: "gpt-4.1", label: "GPT-4.1" },
    { modelId: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { modelId: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { modelId: "o3", label: "O3" },
    { modelId: "o3-mini", label: "O3 Mini" },
    { modelId: "o4-mini", label: "O4 Mini" },
    { modelId: "gpt-4.5-preview", label: "GPT-4.5 Preview" },
  ],
  anthropic: [
    { modelId: "claude-sonnet-4", label: "Claude Sonnet 4" },
    { modelId: "claude-opus-4", label: "Claude Opus 4" },
    { modelId: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (2025-05-14)" },
    { modelId: "claude-haiku-3-5", label: "Claude Haiku 3.5" },
    { modelId: "claude-sonnet-3-5", label: "Claude Sonnet 3.5" },
    { modelId: "claude-opus-3-5", label: "Claude Opus 3.5" },
  ],
  deepseek: [
    { modelId: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { modelId: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { modelId: "deepseek-chat", label: "DeepSeek Chat" },
    { modelId: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ],
  openrouter: [
    { modelId: "openrouter-auto", label: "OpenRouter (auto)" },
  ],
  gemini: [
    { modelId: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { modelId: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { modelId: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite Preview" },
  ],
  ollama: [
    { modelId: "llama3.1:8b", label: "Llama 3.1 8B (CPU)" },
    { modelId: "llama3.2-vision:11b", label: "Llama 3.2 Vision 11B" },
    { modelId: "llama3.3:70b", label: "Llama 3.3 70B" },
    { modelId: "llama3:70b", label: "Llama 3 70B" },
    { modelId: "mistral:7b", label: "Mistral 7B" },
    { modelId: "mixtral:8x7b", label: "Mixtral 8x7B" },
    { modelId: "codellama:7b", label: "CodeLlama 7B" },
    { modelId: "gemma2:9b", label: "Gemma 2 9B" },
    { modelId: "phi3:14b", label: "Phi-3 14B" },
    { modelId: "nomic-embed-text", label: "Nomic Embed Text" },
  ],
};

export function PortalSettingsClient() {
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<UserRow[]>([]);
  const [canEditSecrets, setCanEditSecrets] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Модели ИИ state
  const [providers, setПровайдеры] = useState<Provider[]>([]);
  const [globalModels, setGlobalModels] = useState<GlobalModelEntry[]>([]);
  const [weightsDraft, setWeightsDraft] = useState<Record<string, number>>({});
  const [proxyDraft, setProxyDraft] = useState<Record<string, boolean>>({});
  const [savingWeights, setSavingWeights] = useState(false);

  // API key management
  const [apiKeyEntries, setApiKeyEntries] = useState<ApiKeyEntry[]>([]);
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [newKeyProviderId, setNewKeyProviderId] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  // Test dialog
  const [testDialog, setTestDialog] = useState<{
    providerName: string;
    providerLabel: string;
    modelId: string;
    modelLabel: string;
  } | null>(null);
  const [testMessages, setTestMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [testLoading, setTestLoading] = useState(false);
  const [testStats, setTestStats] = useState("");
  const [testInput, setTestInput] = useState("");

  // Model browser state
  const [selectedProviderForModels, setSelectedProviderForModels] = useState("");
  const [fetchedProviderModels, setFetchedProviderModels] = useState<Array<{ id: string; name: string }>>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState("");
  const [deleteKeyConfirm, setDeleteKeyConfirm] = useState<string | null>(null);

  // Create user modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createFullName, setCreateFullName] = useState("");
  const [createRole, setCreateRole] = useState("user");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const [sRes, uRes] = await Promise.all([
        fetch("/api/admin/settings", { credentials: "include" }),
        fetch("/api/admin/users", { credentials: "include" }),
      ]);
      const sj = await sRes.json().catch(() => ({}));
      const uj = await uRes.json().catch(() => ({}));
      if (!sRes.ok) throw new Error(sj.error || "settings");
      if (!uRes.ok) throw new Error(uj.error || "users");
      setGroups(sj.groups || {});
      const rows = (sj.settings || []) as SettingRow[];
      setSettings(rows);
      const d: Record<string, string> = {};
      for (const r of rows) {
        if (!r.isSecret) d[r.key] = r.value;
      }
      setDraft(d);
      setCanEditSecrets(!!sj.canEditSecrets);
      setUsers(uj.users || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const [provRes, globRes] = await Promise.all([
        fetch("/api/models/providers", { credentials: "include" }),
        fetch("/api/admin/models/global", { credentials: "include" }),
      ]);
      let plist: Provider[] = [];
      if (provRes.ok) {
        const pj = await provRes.json();
        plist = pj.providers ?? [];
        setПровайдеры(plist);
      }
      if (globRes.ok) {
        const gj = await globRes.json();
        const models = (gj.models ?? []) as GlobalModelEntry[];
        setGlobalModels(models);
        const wd: Record<string, number> = {};
        for (const m of models) {
          wd[m.id] = m.weight;
        }
        setWeightsDraft(wd);
        const pd: Record<string, boolean> = {};
        for (const m of models) {
          pd[m.id] = m.useProxy;
        }
        setProxyDraft(pd);
      }
      // Build API key entries from all providers that have apiKeyRef
      if (plist.length > 0) {
        buildApiKeyEntries(plist);
      }
    } catch {
      // silent — models section just won't show full data
    }
  }, []);

  const loadProviderModels = useCallback(async (providerName: string) => {
    if (!providerName) {
      setFetchedProviderModels([]);
      return;
    }
    setFetchingModels(true);
    setFetchModelsError("");
    try {
      const res = await fetch("/api/models/providers/" + encodeURIComponent(providerName) + "/models", { credentials: "include" });
      const j = await res.json();
      if (j.ok && Array.isArray(j.models)) {
        setFetchedProviderModels(j.models);
      } else {
        setFetchModelsError(j.error || "Failed to load models");
        setFetchedProviderModels([]);
      }
    } catch (e) {
      setFetchModelsError(e instanceof Error ? e.message : String(e));
      setFetchedProviderModels([]);
    } finally {
      setFetchingModels(false);
    }
  }, []);

  function buildApiKeyEntries(provList: Provider[]) {
    const entries: ApiKeyEntry[] = [];
    for (const p of provList) {
      const apiRef = p.apiKeyRef;
      if (!apiRef) continue;
      const secretRow = settings.find((s) => s.key === apiRef);
      entries.push({
        providerId: p.id,
        providerName: p.name,
        providerLabel: p.label,
        settingKey: apiRef,
        isSet: secretRow?.secretSet ?? false,
      });
    }
    setApiKeyEntries(entries);
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading) {
      void loadModels();
    }
  }, [loading, loadModels]);

  // Rebuild API key entries when both providers and settings load
  useEffect(() => {
    if (providers.length > 0 && settings.length > 0) {
      buildApiKeyEntries(providers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, settings]);

  // Filter out deprecated model spec settings from the ai group
  const byGroup = useMemo(() => {
    const m = new Map<string, SettingRow[]>();
    const skipKeys = new Set(["SHECTORY_EXECUTOR_MODEL_SPEC", "SHECTORY_AUDITOR_MODEL_SPEC"]);
    for (const s of settings) {
      if (s.isSecret) continue;
      if (skipKeys.has(s.key)) continue;
      const g = s.group || "general";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(s);
    }
    return m;
  }, [settings]);

  async function saveConstants() {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: draft }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "save");
      setMsg("Сохранено. Раннеры агентов подхватят значения из data/portal-runtime-env.json.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveApiKey(providerId: string, settingKey: string, value: string) {
    if (!canEditSecrets || !value.trim()) return;
    setSavingKey(true);
    setMsg("");
    setErr("");
    try {
      const r = await fetch("/api/admin/settings/secrets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: value.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "secret");
      setMsg("API-ключ сохранён.");
      setNewKeyValue("");
      setShowAddKeyModal(false);
      await load();
      await loadModels();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(false);
    }
  }

  async function deleteApiKey(settingKey: string) {
    if (!canEditSecrets) return;
    setSavingKey(true);
    setMsg("");
    setErr("");
    try {
      const r = await fetch("/api/admin/settings/secrets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: "" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "delete key");
      setMsg("API-ключ удалён.");
      setDeleteKeyConfirm(null);
      await load();
      await loadModels();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(false);
    }
  }

  async function toggleProvider(providerId: string, enabled: boolean) {
    setErr("");
    setMsg("");
    try {
      const r = await fetch(`/api/models/providers/${encodeURIComponent(providerId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "toggle");
      await loadModels();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveWeights() {
    setSavingWeights(true);
    setErr("");
    setMsg("");
    try {
      const updates = Object.entries(weightsDraft).map(([id, weight]) => ({
        id,
        weight: Math.max(1, Math.min(100, Math.round(weight))),
      }));
      const r = await fetch("/api/admin/models/weights", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "save weights");
      setMsg("Веса моделей сохранены.");
      await loadModels();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingWeights(false);
    }
  }

  async function sendTestMessage(msg: string) {
    if (!testDialog || !msg.trim()) return;
    setTestLoading(true);
    setTestStats("");
    const newMsgs = [...testMessages, { role: "user" as const, content: msg }];
    setTestMessages(newMsgs);
    setTestInput("");

    try {
      const r = await fetch("/api/admin/models/test-chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerName: testDialog.providerName,
          modelId: testDialog.modelId,
          message: msg,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setTestMessages((prev) => [
          ...prev,
          { role: "assistant", content: j.response },
        ]);
        const stats = `⏱ ${j.elapsedMs}ms | ${j.tokensPerSec}`;
        setTestStats(stats);
      } else {
        setTestMessages((prev) => [
          ...prev,
          { role: "assistant", content: `❌ Ошибка: ${j.error}` },
        ]);
        setTestStats(`⏱ ${j.elapsedMs || "?"}ms`);
      }
    } catch (e) {
      setTestMessages((prev) => [
        ...prev,
        { role: "assistant", content: `❌ Ошибка запроса: ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setTestLoading(false);
    }
  }

  async function changeUserRole(userId: string, role: string) {
    setErr("");
    try {
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "role");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function createUser() {
    setErr("");
    setCreating(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createEmail,
          password: createPassword,
          fullName: createFullName,
          role: createRole,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "create");
      setMsg(`User ${createEmail} created.`);
      setShowCreateModal(false);
      setCreateEmail("");
      setCreatePassword("");
      setCreateFullName("");
      setCreateRole("user");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function deleteUser(userId: string) {
    setErr("");
    try {
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "delete");
      setMsg("Пользователь удалён.");
      setDeleteConfirm(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function uploadSound(file: File | null) {
    if (!file) return;
    setErr("");
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/auth/notifications/sound", { method: "POST", credentials: "include", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j.error || "upload sound");
      return;
    }
    setMsg(`Звук загружен (${j.size} байт).`);
  }

  async function clearSound() {
    setErr("");
    const r = await fetch("/api/auth/notifications/sound", { method: "DELETE", credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || "delete sound");
      return;
    }
    setMsg("Пользовательский звук удалён (будет fallback).");
  }

  function resetCreateForm() {
    setCreateEmail("");
    setCreatePassword("");
    setCreateFullName("");
    setCreateRole("user");
    setShowCreateModal(false);
  }

  function openTestDialog(providerName: string, providerLabel: string, modelId: string, modelLabel: string) {
    setTestDialog({ providerName, providerLabel, modelId, modelLabel });
    setTestMessages([]);
    setTestStats("");
    setTestInput("");
  }

  // Group global models by provider
  const modelsByProvider = useMemo(() => {
    const m = new Map<string, GlobalModelEntry[]>();
    for (const mo of globalModels) {
      const pId = mo.providerId;
      if (!m.has(pId)) m.set(pId, []);
      m.get(pId)!.push(mo);
    }
    return m;
  }, [globalModels]);

  // Get providers that have apiKeyRef but key is not set (for "+ Add Key" dropdown)
  const providersWithoutKey = useMemo(() => {
    const withKey = new Set(apiKeyEntries.map((e) => e.providerId));
    return providers.filter((p) => p.apiKeyRef && !withKey.has(p.id));
  }, [providers, apiKeyEntries]);

  if (loading) {
    return <div className="text-slate-400">Загрузка настроек...</div>;
  }

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-10 px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white sm:text-2xl">Настройки портала</h1>
          <p className="mt-1 text-sm text-slate-400">
            Каталог пользователей, параметры агентов и чата, звук уведомлений, ключи внешних API.
          </p>
        </div>
        <Link href="/projects" className="text-sm text-blue-400 hover:underline">
          &larr; К проектам
        </Link>
      </div>

      {msg ? <p className="rounded border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{msg}</p> : null}
      {err ? <p className="rounded border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">{err}</p> : null}

      {/* Users & Roles */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-white">Users  и роли</h2>
            <p className="mt-1 text-sm text-slate-500">
              Manage accounts. Only <span className="text-slate-300">superadmin</span> can change roles or delete users.
              Роли: user (без доступа к /projects), admin, superadmin.
            </p>
          </div>
          {canEditSecrets ? (
            <button
              type="button"
              className="min-h-[44px] rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 touch-manipulation"
              onClick={() => setShowCreateModal(true)}
            >
              + Создать
            </button>
          ) : null}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">E-mail</th>
                <th className="py-2 pr-3">Имя</th>
                <th className="py-2 pr-3">Роль</th>
                <th className="py-2 pr-3">Создан</th>
                <th className="py-2 pr-3">Вериф.</th>
                <th className="py-2">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-3 font-mono text-xs">{u.email}</td>
                  <td className="py-2 pr-3 text-slate-400">{u.fullName || "-"}</td>
                  <td className="py-2 pr-3">
                    <select
                      className="min-h-[40px] rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm disabled:opacity-50"
                      value={u.role}
                      disabled={!canEditSecrets}
                      onChange={(e) => void changeUserRole(u.id, e.target.value)}
                      title={canEditSecrets ? "" : "Только superadmin"}
                    >
                      {PORTAL_USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{new Date(u.createdAt).toLocaleString("ru-RU")}</td>
                  <td className="py-2 pr-3 text-xs">{u.emailVerifiedAt ? "\u2713" : "-"}</td>
                  <td className="py-2">
                    {canEditSecrets ? (
                      <button
                        type="button"
                        className="rounded border border-red-800/50 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50 disabled:opacity-40"
                        disabled={!!deleteConfirm}
                        onClick={() => setDeleteConfirm(u.id)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create user modal */}
      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white">Создать пользователя</h3>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-sm text-slate-400">E-mail</span>
                <input
                  type="email"
                  autoComplete="off"
                  className="mt-1 min-h-[44px] w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-400">Пароль (мин. 8 символов)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 min-h-[44px] w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-400">Полное имя</span>
                <input
                  type="text"
                  autoComplete="off"
                  className="mt-1 min-h-[44px] w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                  value={createFullName}
                  onChange={(e) => setCreateFullName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-400">Роль</span>
                <select
                  className="mt-1 min-h-[44px] w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value)}
                >
                  {PORTAL_USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="min-h-[44px] rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 touch-manipulation"
                onClick={resetCreateForm}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating || !createEmail.trim() || !createPassword}
                className="min-h-[44px] rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 touch-manipulation"
                onClick={() => void createUser()}
              >
                {creating ? "Создание..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete user confirmation */}
      {deleteConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white">Подтверждение удаления</h3>
            <p className="mt-2 text-sm text-slate-400">
              Вы уверены, что хотите удалить этого пользователя? Действие необратимо.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="min-h-[44px] rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 touch-manipulation"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 touch-manipulation"
                onClick={() => void deleteUser(deleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
        <h2 className="text-lg font-medium text-white">Звук колокольчика</h2>
        <p className="mt-1 text-sm text-slate-500">Файл MP3 до 2 МБ. Сохраняется в data/portal-sounds (не в public).</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            className="max-w-full text-sm text-slate-300"
            onChange={(e) => void uploadSound(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="min-h-[44px] rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 touch-manipulation"
            onClick={() => void clearSound()}
          >
            Сбросить свой звук
          </button>
        </div>
      </section>

      {/* ===== МОДЕЛИ ИИ ===== */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
        <h2 className="text-lg font-medium text-white">Модели ИИ</h2>
        <p className="mt-1 text-sm text-slate-500">
          Управление API-ключами, статусом провайдеров, весами приоритета и просмотр моделей через API.
        </p>

        {/* API keys — dynamic list */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">API-ключи</h3>
              <p className="text-xs text-slate-600">
                Ключи не отображаются после сохранения. Ollama не требует ключа.
              </p>
            </div>
            {canEditSecrets && (
              <button
                type="button"
                className="min-h-[36px] rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 touch-manipulation"
                onClick={() => {
                  setNewKeyProviderId("");
                  setNewKeyValue("");
                  setShowAddKeyModal(true);
                }}
              >
                + Добавить ключ
              </button>
            )}
          </div>

          {/* List of saved API keys */}
          <div className="mt-3 space-y-2">
            {apiKeyEntries.length === 0 ? (
              <p className="text-xs text-slate-500 italic">
                Нет сохранённых API-ключей. Нажмите «+ Добавить ключ», чтобы добавить.
              </p>
            ) : (
              apiKeyEntries.map((entry) => (
                <div
                  key={entry.providerId}
                  className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-black/20 p-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-sm">
                    {entry.providerName === "openai" ? "🧠" :
                     entry.providerName === "anthropic" ? "🤖" :
                     entry.providerName === "deepseek" ? "🔍" :
                     entry.providerName === "openrouter" ? "🔄" :
                     "🔑"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white">{entry.providerLabel}</div>
                    <div className="text-[10px] font-mono text-slate-500">{entry.settingKey}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
                        entry.isSet
                          ? "bg-emerald-900/40 text-emerald-300"
                          : "bg-red-900/30 text-red-400"
                      }`}
                    >
                      {entry.isSet ? "✅" : "❌"}
                      {entry.isSet ? " set" : " not set"}
                    </span>
                    <button
                      type="button"
                      disabled={!canEditSecrets}
                      className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-800 disabled:opacity-40 touch-manipulation"
                      onClick={() => {
                        setNewKeyProviderId(entry.providerId);
                        setNewKeyValue("");
                        setShowAddKeyModal(true);
                      }}
                      title="Обновить ключ"
                    >
                      ✏️
                    </button>
                    {entry.isSet && (
                      <button
                        type="button"
                        disabled={!canEditSecrets}
                        className="rounded border border-red-800/40 px-2 py-1 text-[10px] text-red-400 hover:bg-red-950/30 disabled:opacity-40 touch-manipulation"
                        onClick={() => setDeleteKeyConfirm(entry.settingKey)}
                        title="Удалить ключ"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Провайдеры On/Off */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Провайдеры</h3>
          <p className="mb-3 text-xs text-slate-600">
            Включение/отключение провайдеров. Выключенный провайдер недоступен для выбора модели.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Провайдер</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Ключ</th>
                  <th className="py-2">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {providers.map((p) => {
                  const keyEntry = apiKeyEntries.find((e) => e.providerId === p.id);
                  return (
                    <tr key={p.id}>
                      <td className="py-2 pr-3">
                        <span className="text-sm text-white">{p.label}</span>
                        <span className="ml-2 font-mono text-[10px] text-slate-500">{p.name}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs ${
                            p.enabled
                              ? "bg-emerald-900/40 text-emerald-300"
                              : "bg-red-900/30 text-red-400"
                          }`}
                        >
                          {p.enabled ? "enabled" : "disabled"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {p.name === "ollama" ? (
                          <span className="text-slate-500">—</span>
                        ) : keyEntry ? (
                          keyEntry.isSet ? (
                            <span className="text-emerald-400">✅</span>
                          ) : (
                            <span className="text-red-400">❌</span>
                          )
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          disabled={saving}
                          className={`min-h-[36px] rounded px-3 py-1.5 text-xs font-medium touch-manipulation ${
                            p.enabled
                              ? "border border-red-800/50 text-red-400 hover:bg-red-950/50"
                              : "border border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/50"
                          }`}
                          onClick={() => void toggleProvider(p.id, !p.enabled)}
                        >
                          {p.enabled ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Model browser: fetch models from provider API */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Список моделей провайдера</h3>
          <p className="mb-3 text-xs text-slate-600">
            Выберите провайдера, чтобы загрузить актуальный список его моделей через API.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="min-h-[40px] rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
              value={selectedProviderForModels}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedProviderForModels(val);
                if (val) {
                  void loadProviderModels(val);
                } else {
                  setFetchedProviderModels([]);
                }
              }}
            >
              <option value="">— выберите провайдера —</option>
              {providers.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.label}
                </option>
              ))}
            </select>
            {fetchingModels && (
              <span className="text-xs text-slate-400 animate-pulse">Загрузка...</span>
            )}
            {fetchModelsError && (
              <span className="text-xs text-red-400">{fetchModelsError}</span>
            )}
          </div>

          {fetchedProviderModels.length > 0 && (
            <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-700/40 bg-black/20">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pl-3 pr-2">ID модели</th>
                    <th className="py-2 px-2">Название</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {fetchedProviderModels.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-800/40">
                      <td className="py-1.5 pl-3 pr-2 font-mono text-[11px] text-slate-400">{m.id}</td>
                      <td className="py-1.5 px-2 text-slate-200">{m.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedProviderForModels && !fetchingModels && fetchedProviderModels.length === 0 && !fetchModelsError && (
            <p className="mt-2 text-xs text-slate-500 italic">Нет моделей или API недоступен.</p>
          )}
        </div>

        {/* Model weights */}

        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Веса использования моделей
              </h3>
              <p className="text-xs text-slate-600">
                Приоритет модели (1–100). Чем выше — тем приоритетнее.
              </p>
            </div>
            <button
              type="button"
              disabled={savingWeights}
              className="min-h-[36px] rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 touch-manipulation"
              onClick={() => void saveWeights()}
            >
              {savingWeights ? "Сохранение..." : "Сохранить веса"}
            </button>
          </div>
          <div className="mt-3 space-y-4">
            {Array.from(modelsByProvider.entries()).map(([pId, models]) => {
              const prov = providers.find((p) => p.id === pId);
              return (
                <div key={pId} className="rounded-lg border border-slate-700/40 bg-black/20 p-3">
                  <h4 className="mb-2 text-xs font-medium text-slate-400">
                    {prov?.label || pId}
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {models.map((m) => (
                      <div
                        key={m.id}
                        className="flex flex-col gap-2 rounded border border-slate-800 bg-slate-900/60 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-white break-words">{m.label}</div>
                          <div className="text-[10px] text-slate-500">
                            {m.project.name}
                            {m.isDefault ? (
                              <span className="ml-1 text-blue-400">* default</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                          <input
                            type="number"
                            min={1}
                            max={100}
                            className="w-14 rounded border border-slate-600 bg-slate-950 px-1.5 py-1 text-center text-xs text-white"
                            value={weightsDraft[m.id] ?? m.weight}
                            onChange={(e) =>
                              setWeightsDraft((d) => ({
                                ...d,
                                [m.id]: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                              }))
                            }
                          />
                          <input
                            type="range"
                            min={1}
                            max={100}
                            className="w-20 min-w-0 max-w-24 accent-blue-500"
                            value={weightsDraft[m.id] ?? m.weight}
                            onChange={(e) =>
                              setWeightsDraft((d) => ({
                                ...d,
                                [m.id]: Number(e.target.value),
                              }))
                            }
                          />
                          <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer select-none hover:text-slate-200 bg-slate-800/50 rounded px-1.5 py-1 border border-slate-700/50" title="Использовать прокси для этого провайдера">
                            <input
                              type="checkbox"
                              className="accent-blue-500"
                              checked={proxyDraft[m.id] ?? m.useProxy}
                              onChange={(e) =>
                                setProxyDraft((d) => ({
                                  ...d,
                                  [m.id]: e.target.checked,
                                }))
                              }
                            />
                            Proxy
                          </label>
                          <button
                            type="button"
                            className="rounded border border-blue-700/50 bg-blue-950/30 px-1.5 py-1 text-[10px] text-blue-300 hover:bg-blue-900/50 hover:text-blue-200 touch-manipulation font-medium"
                            onClick={() =>
                              openTestDialog(
                                prov?.name || "",
                                prov?.label || pId,
                                m.modelId,
                                m.label
                              )
                            }
                            title="Тест диалога"
                          >
                            🧪 Тест
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {globalModels.length === 0 ? (
              <p className="text-xs text-slate-500">
                No models found. Add models on a project page in the &quot;AI Model&quot; section.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-medium text-white">Параметры системы</h2>
          <button
            type="button"
            disabled={saving}
            className="min-h-[44px] rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 touch-manipulation"
            onClick={() => void saveConstants()}
          >
            {saving ? "Сохранение..." : "Сохранить параметры"}
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Значения записываются в БД и дублируются в{" "}
          <code className="text-slate-400">data/portal-runtime-env.json</code> for background Node scripts. Secrets are not
          duplicated via this list.
        </p>

        {Array.from(byGroup.entries()).map(([gid, rows]) => (
          <div key={gid} className="rounded-xl border border-slate-800 bg-black/20 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {groups[gid] || gid}
            </h3>
            <div className="mt-4 grid gap-4">
              {rows.map((s) => {
                const def = settings.find((x) => x.key === s.key);
                // enum-опции берём из реестра (s.enumValues); спец-случай булевого тумблера.
                const enumVals: string[] | null =
                  s.enumValues && s.enumValues.length > 0
                    ? s.enumValues
                    : s.key === "SHECTORY_AGENT_ALLOW_COMMANDS"
                      ? ["0", "1"]
                      : null;
                return (
                  <label key={s.key} className="block min-w-0">
                    <span className="text-xs font-medium text-slate-400">{def?.label || s.key}</span>
                    {def?.description ? (
                      <span className="mt-0.5 block text-xs text-slate-600">{def.description}</span>
                    ) : null}
                    {enumVals ? (
                      <select
                        className="mt-1 min-h-[44px] w-full max-w-lg rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
                        value={draft[s.key] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      >
                        {enumVals.map((v) => (
                          <option key={v || "empty"} value={v}>
                            {v === "" ? "(как у исполнителя)" : v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="mt-1 min-h-[44px] w-full max-w-lg rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                        value={draft[s.key] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      />
                    )}
                    <span className="mt-1 block font-mono text-[10px] text-slate-600">{s.key}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* ===== ADD KEY MODAL ===== */}
      {showAddKeyModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white">Добавить API-ключ</h3>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-sm text-slate-400">Провайдер</span>
                <select
                  className="mt-1 min-h-[44px] w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                  value={newKeyProviderId}
                  onChange={(e) => setNewKeyProviderId(e.target.value)}
                >
                  <option value="">— выберите провайдера —</option>
                  {providers
                    .filter((p) => p.apiKeyRef)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} ({p.name})
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-slate-400">API-ключ</span>
                <input
                  type="password"
                  autoComplete="off"
                  className="mt-1 min-h-[44px] w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                  placeholder="sk-..."
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                />
              </label>
              {newKeyProviderId && (() => {
                const selProv = providers.find((p) => p.id === newKeyProviderId);
                const presets = MODEL_PRESETS[selProv?.name || ""];
                return (
                  <div className="space-y-2">
                    <p className="text-[10px] text-slate-500">
                      Будет сохранён как секрет &quot;{selProv?.apiKeyRef || "?"}&quot;
                    </p>
                    {presets && presets.length > 0 && (
                      <div className="rounded border border-slate-700/50 bg-black/30 p-2">
                        <p className="mb-1 text-[10px] font-medium text-slate-400">Поддерживаемые модели {selProv?.label}:</p>
                        <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                          {presets.map((pm) => (
                            <span key={pm.modelId} className="inline-block rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300">
                              {pm.label}
                            </span>
                          ))}
                        </div>
                        <a
                          href={{
                            "openai": "https://platform.openai.com/docs/models",
                            "anthropic": "https://docs.anthropic.com/en/docs/about-claude/models",
                            "deepseek": "https://api-docs.deepseek.com/docs/models",
                            "openrouter": "https://openrouter.ai/models",
                            "gemini": "https://ai.google.dev/gemini-api/docs/models",
                            "ollama": "https://ollama.com/library"
                          }[selProv?.name || ""] || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-[10px] text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          📖 Документация {selProv?.label} →
                        </a>
                      </div>
                    ) || null}
                  </div>
                );
              })()}
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="min-h-[44px] rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 touch-manipulation"
                onClick={() => setShowAddKeyModal(false)}
                disabled={savingKey}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  savingKey ||
                  !newKeyProviderId ||
                  !newKeyValue.trim()
                }
                className="min-h-[44px] rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 touch-manipulation"
                onClick={() => {
                  const p = providers.find((pr) => pr.id === newKeyProviderId);
                  if (p && p.apiKeyRef) {
                    void saveApiKey(p.id, p.apiKeyRef, newKeyValue);
                  }
                }}
              >
                {savingKey ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== DELETE KEY CONFIRMATION ===== */}
      {deleteKeyConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white">Удалить API-ключ?</h3>
            <p className="mt-2 text-sm text-slate-400">
              Ключ будет стёрт из базы данных. Модели этого провайдера перестанут работать.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="min-h-[44px] rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 touch-manipulation"
                onClick={() => setDeleteKeyConfirm(null)}
                disabled={savingKey}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingKey}
                className="min-h-[44px] rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 touch-manipulation"
                onClick={() => void deleteApiKey(deleteKeyConfirm)}
              >
                {savingKey ? "Удаление..." : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== TEST DIALOG MODAL ===== */}
      {testDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <div>
                <h3 className="text-sm font-medium text-white">
                  🧪 Тест диалога
                </h3>
                <p className="text-xs text-slate-500">
                  {testDialog.providerLabel} → {testDialog.modelLabel}
                </p>
              </div>
              <button
                type="button"
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                onClick={() => {
                  setTestDialog(null);
                  setTestMessages([]);
                  setTestStats("");
                }}
              >
                ✕
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 p-4">
              {testMessages.length === 0 && !testLoading && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="text-sm text-slate-500">Нажмите «Отправить», чтобы проверить модель</p>
                  <button
                    type="button"
                    className="mt-3 min-h-[36px] rounded bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 touch-manipulation"
                    onClick={() => void sendTestMessage("Расскажи о себе: твоё назначение, ключевые компетенции, точная спецификация версии и краткая история развития с датами релизов. Ответ напиши на русском, 130–200 слов.")}
                  >
                    🚀 Отправить тестовый запрос
                  </button>
                </div>
              )}
              {testMessages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-blue-700/60 text-white"
                        : "bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </div>
                </div>
              ))}
              {testLoading && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-slate-800/80 px-3 py-2 text-sm text-slate-400">
                    <span className="animate-pulse">Думает...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Stats bar */}
            {testStats && (
              <div className="border-t border-slate-700 px-4 py-1.5 text-[10px] text-slate-500">
                {testStats}
              </div>
            )}

            {/* Input */}
            <div className="flex items-center gap-2 border-t border-slate-700 px-4 py-3">
              <input
                type="text"
                className="min-h-[40px] flex-1 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="Введите сообщение..."
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && testInput.trim() && !testLoading) {
                    e.preventDefault();
                    void sendTestMessage(testInput);
                  }
                }}
                disabled={testLoading}
              />
              <button
                type="button"
                disabled={testLoading || !testInput.trim()}
                className="min-h-[40px] rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 touch-manipulation"
                onClick={() => void sendTestMessage(testInput)}
              >
                {testLoading ? "..." : "→"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

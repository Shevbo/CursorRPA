"use client";

import { useCallback, useEffect, useState } from "react";

type Provider = {
  id: string;
  name: string;
  label: string;
  baseUrl: string | null;
  apiKeyRef: string | null;
  enabled: boolean;
  icon: string | null;
};

type ProjectModelEntry = {
  id: string;
  providerId: string;
  modelId: string;
  label: string;
  isDefault: boolean;
  provider: {
    id: string;
    name: string;
    label: string;
    icon: string | null;
  };
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

export function ProjectAIModelsPanel({ projectSlug }: { projectSlug: string }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [projectModels, setProjectModels] = useState<ProjectModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [provRes, modelsRes] = await Promise.all([
        fetch("/api/models/providers", { credentials: "include" }),
        fetch(`/api/models/by-project/${encodeURIComponent(projectSlug)}`, { credentials: "include" }),
      ]);
      if (!provRes.ok || !modelsRes.ok) throw new Error("Ошибка загрузки");
      const provJson = await provRes.json();
      const modelsJson = await modelsRes.json();
      setProviders(provJson.providers ?? []);
      setProjectModels(modelsJson.projectModels ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const defaultModel = projectModels.find((m) => m.isDefault);
  const otherModels = projectModels.filter((m) => !m.isDefault);

  async function addModel(providerId: string, modelId: string, label: string) {
    setSaving(true);
    setError("");
    setSuccessMsg("");
    try {
      const r = await fetch(`/api/models/by-project/${encodeURIComponent(projectSlug)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          modelId,
          label,
          isDefault: projectModels.length === 0,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Ошибка сохранения");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(entryId: string) {
    const entry = projectModels.find((m) => m.id === entryId);
    if (!entry) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/models/by-project/${encodeURIComponent(projectSlug)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: entry.providerId,
          modelId: entry.modelId,
          label: entry.label,
          isDefault: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Ошибка");
      setSuccessMsg("Модель по умолчанию изменена ✓");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteModel(entryId: string) {
    setError("");
    setSuccessMsg("");
    try {
      const r = await fetch(
        `/api/models/by-project/${encodeURIComponent(projectSlug)}/${encodeURIComponent(entryId)}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!r.ok) throw new Error("Ошибка удаления");
      setSuccessMsg("Модель удалена ✓");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function getAvailablePresets() {
    const added = new Set(projectModels.map((m) => `${m.providerId}:${m.modelId}`));
    const available: Array<{ providerId: string; providerLabel: string; providerName: string; modelId: string; label: string }> = [];
    for (const p of providers) {
      if (!p.enabled) continue;
      const presets = MODEL_PRESETS[p.name] ?? [];
      for (const m of presets) {
        if (!added.has(`${p.id}:${m.modelId}`)) {
          available.push({
            providerId: p.id,
            providerLabel: p.label,
            providerName: p.name,
            modelId: m.modelId,
            label: m.label,
          });
        }
      }
    }
    return available;
  }

  const availablePresets = getAvailablePresets();

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <span className="text-sm text-slate-500">Загрузка...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-400">Модель ИИ</h3>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Добавить
          </button>
        )}
      </div>

      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}
      {successMsg && <div className="mb-2 text-xs text-emerald-400">{successMsg}</div>}

      {/* Active model */}
      {defaultModel ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-700/50 bg-blue-950/30 px-3 py-2.5">
          <span className="text-xs text-blue-400">Активная:</span>
          <span className="text-sm font-medium text-white">
            {defaultModel.provider.label} → {defaultModel.label}
          </span>
          <span className="ml-auto rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-300">
            default
          </span>
        </div>
      ) : (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/30 px-3 py-2.5">
          <span className="text-xs text-slate-500">Модель не выбрана</span>
          <span className="ml-auto text-[10px] text-slate-600">выберите ниже</span>
        </div>
      )}

      {/* Quick-switch buttons (only when >1 model) */}
      {projectModels.length > 1 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] text-slate-500 uppercase tracking-wide">
            Быстрый выбор
          </div>
          <div className="flex flex-wrap gap-1.5">
            {projectModels.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={saving || m.isDefault}
                onClick={() => void setDefault(m.id)}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                  m.isDefault
                    ? "bg-blue-800/40 text-blue-300 ring-1 ring-blue-600/50"
                    : "bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                }`}
              >
                <span>{m.provider.label}</span>
                <span className="opacity-60">→</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All models list with delete */}
      {otherModels.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] text-slate-500 uppercase tracking-wide">Все</div>
          <div className="flex flex-wrap gap-1.5">
            {projectModels.map((m) => (
              <div
                key={m.id}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  m.isDefault
                    ? "bg-blue-900/20 text-blue-400"
                    : "bg-slate-800/40 text-slate-400"
                }`}
              >
                <span>{m.provider.label} → {m.label}</span>
                {!m.isDefault && (
                  <button
                    type="button"
                    onClick={() => void deleteModel(m.id)}
                    className="ml-0.5 text-red-400/60 hover:text-red-300"
                    title="Удалить"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible add form */}
      {showAddForm && (
        <div className="border-t border-slate-700/50 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Добавить модель</span>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              ✕
            </button>
          </div>
          {availablePresets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {availablePresets.map((m, i) => (
                <button
                  key={`${m.providerId}-${m.modelId}-${i}`}
                  type="button"
                  disabled={saving}
                  onClick={() => void addModel(m.providerId, m.modelId, m.label)}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/30 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:bg-slate-700/50 disabled:opacity-50"
                >
                  <span className="text-slate-500">{m.providerLabel}</span>
                  <span className="opacity-40">→</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-600">Все доступные модели уже добавлены</div>
          )}
        </div>
      )}

      {saving && (
        <div className="mt-2 text-[10px] text-slate-500 animate-pulse">Сохранение...</div>
      )}
    </div>
  );
}

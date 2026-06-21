import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Получает список моделей для конкретного провайдера через его API.
 */
export async function GET(req: Request, { params }: { params: { providerId: string } }) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const providerId = params.providerId?.trim();
  if (!providerId) {
    return NextResponse.json({ error: "Missing providerId" }, { status: 400 });
  }

  // Find provider by name (the route param is provider name like "openai", "anthropic", etc.)
  const provider = await prisma.modelProvider.findUnique({ where: { name: providerId } });
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const result = await fetchProviderModels(provider.name, provider.apiKeyRef || null);
  return NextResponse.json({ ok: true, provider: { id: provider.id, name: provider.name, label: provider.label }, models: result.models, raw: result.raw || null });
}

async function getApiKey(keyRef: string): Promise<string | null> {
  const row = await prisma.portalSetting.findUnique({ where: { key: keyRef } });
  return row?.value || null;
}

async function fetchProviderModels(providerName: string, apiKeyRef: string | null): Promise<{ models: Array<{ id: string; name: string }>; raw?: any }> {
  switch (providerName) {
    case "openai":
      return fetchOpenAIModels(apiKeyRef);
    case "anthropic":
      return fetchAnthropicModels(apiKeyRef);
    case "deepseek":
      return fetchDeepSeekModels(apiKeyRef);
    case "openrouter":
      return fetchOpenRouterModels(apiKeyRef);
    case "gemini":
      return fetchGeminiModels(apiKeyRef);
    case "ollama":
      return fetchOllamaModels();
    default:
      return { models: [] };
  }
}

async function fetchOpenAIModels(apiKeyRef: string | null): Promise<{ models: Array<{ id: string; name: string }> }> {
  const apiKey = apiKeyRef ? await getApiKey(apiKeyRef) : null;
  if (!apiKey) return { models: jsonModelsToArray(OPENAI_DEFAULT_MODELS) };

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer " + apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { models: jsonModelsToArray(OPENAI_DEFAULT_MODELS) };
    const json = await res.json();
    const models: Array<{ id: string; name: string }> = (json.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
    }));
    return { models: models.length > 0 ? models : jsonModelsToArray(OPENAI_DEFAULT_MODELS) };
  } catch {
    return { models: jsonModelsToArray(OPENAI_DEFAULT_MODELS) };
  }
}

async function fetchAnthropicModels(apiKeyRef: string | null): Promise<{ models: Array<{ id: string; name: string }> }> {
  const apiKey = apiKeyRef ? await getApiKey(apiKeyRef) : null;
  if (!apiKey) return { models: jsonModelsToArray(ANTHROPIC_DEFAULT_MODELS) };

  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { models: jsonModelsToArray(ANTHROPIC_DEFAULT_MODELS) };
    const json = await res.json();
    const models: Array<{ id: string; name: string }> = (json.data || []).map((m: any) => ({
      id: m.id || m.name || m.type,
      name: m.display_name || m.name || m.id || m.type,
    }));
    return { models: models.length > 0 ? models : jsonModelsToArray(ANTHROPIC_DEFAULT_MODELS) };
  } catch {
    return { models: jsonModelsToArray(ANTHROPIC_DEFAULT_MODELS) };
  }
}

async function fetchDeepSeekModels(apiKeyRef: string | null): Promise<{ models: Array<{ id: string; name: string }> }> {
  const apiKey = apiKeyRef ? await getApiKey(apiKeyRef) : null;
  if (!apiKey) return { models: jsonModelsToArray(DEEPSEEK_DEFAULT_MODELS) };

  try {
    const res = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { models: jsonModelsToArray(DEEPSEEK_DEFAULT_MODELS) };
    const json = await res.json();
    const models: Array<{ id: string; name: string }> = (json.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
    }));
    return { models: models.length > 0 ? models : jsonModelsToArray(DEEPSEEK_DEFAULT_MODELS) };
  } catch {
    return { models: jsonModelsToArray(DEEPSEEK_DEFAULT_MODELS) };
  }
}

async function fetchOpenRouterModels(apiKeyRef: string | null): Promise<{ models: Array<{ id: string; name: string }> }> {
  const apiKey = apiKeyRef ? await getApiKey(apiKeyRef) : null;
  if (!apiKey) return { models: jsonModelsToArray(OPENROUTER_DEFAULT_MODELS) };

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { models: jsonModelsToArray(OPENROUTER_DEFAULT_MODELS) };
    const json = await res.json();
    const models: Array<{ id: string; name: string }> = (json.data || []).map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
    }));
    return { models: models.length > 0 ? models : jsonModelsToArray(OPENROUTER_DEFAULT_MODELS) };
  } catch {
    return { models: jsonModelsToArray(OPENROUTER_DEFAULT_MODELS) };
  }
}

async function fetchGeminiModels(apiKeyRef: string | null): Promise<{ models: Array<{ id: string; name: string }> }> {
  const apiKey = apiKeyRef ? await getApiKey(apiKeyRef) : null;
  let liveModels: Array<{ id: string; name: string }> = [];

  // Try to fetch from Google AI API if key is available
  if (apiKey) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(apiKey), {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        liveModels = (json.models || []).filter((m: any) => m.name).map((m: any) => ({
          id: m.name.replace("models/", ""),
          name: m.displayName || m.name.replace("models/", ""),
        }));
      }
    } catch {
      // fall through to defaults
    }
  }

  // Always include the hardcoded Gemini model list
  const hardcoded = jsonModelsToArray(GEMINI_DEFAULT_MODELS);

  // Merge: live takes priority, then hardcoded (deduplicated by id)
  const seen = new Set<string>();
  const merged: Array<{ id: string; name: string }> = [];
  for (const m of [...liveModels, ...hardcoded]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      merged.push(m);
    }
  }

  return { models: merged.length > 0 ? merged : hardcoded };
}

async function fetchOllamaModels(): Promise<{ models: Array<{ id: string; name: string }> }> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json().catch(() => ({}));
    const models = (json.models || []).map((m: any) => ({
      id: m.name,
      name: m.name,
    }));
    return { models: models.length > 0 ? models : jsonModelsToArray(OLLAMA_DEFAULT_MODELS) };
  } catch {
    return { models: jsonModelsToArray(OLLAMA_DEFAULT_MODELS) };
  }
}

function jsonModelsToArray(arr: Array<{ modelId: string; label: string }>): Array<{ id: string; name: string }> {
  return arr.map((m) => ({ id: m.modelId, name: m.label }));
}

// Fallback model lists (matching MODEL_PRESETS in PortalSettingsClient.tsx)

const OPENAI_DEFAULT_MODELS = [
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
];

const ANTHROPIC_DEFAULT_MODELS = [
  { modelId: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { modelId: "claude-opus-4", label: "Claude Opus 4" },
  { modelId: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (2025-05-14)" },
  { modelId: "claude-haiku-3-5", label: "Claude Haiku 3.5" },
  { modelId: "claude-sonnet-3-5", label: "Claude Sonnet 3.5" },
  { modelId: "claude-opus-3-5", label: "Claude Opus 3.5" },
];

const DEEPSEEK_DEFAULT_MODELS = [
  { modelId: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { modelId: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { modelId: "deepseek-chat", label: "DeepSeek Chat" },
  { modelId: "deepseek-reasoner", label: "DeepSeek Reasoner" },
];

const OPENROUTER_DEFAULT_MODELS = [
  { modelId: "openrouter-auto", label: "OpenRouter (auto)" },
];

const GEMINI_DEFAULT_MODELS = [
  { modelId: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { modelId: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { modelId: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite Preview" },
  { modelId: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { modelId: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  { modelId: "gemini-2.0-pro", label: "Gemini 2.0 Pro" },
  { modelId: "gemini-2.5-pro-preview", label: "Gemini 2.5 Pro Preview (05-2025)" },
  { modelId: "gemini-2.5-flash-preview", label: "Gemini 2.5 Flash Preview (04-2025)" },
  { modelId: "gemini-2.5-flash-lite-preview", label: "Gemini 2.5 Flash Lite Preview (04-2025)" },
  { modelId: "gemini-2.5-pro-exp-03-25", label: "Gemini 2.5 Pro Exp (03-2025)" },
  { modelId: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { modelId: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  { modelId: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B" },
  { modelId: "gemini-1.0-pro", label: "Gemini 1.0 Pro" },
  { modelId: "gemini-pro-vision", label: "Gemini Pro Vision" },
  { modelId: "learnlm-1.5-pro-experimental", label: "LearnLM 1.5 Pro Experimental" },
  { modelId: "embedding-001", label: "Embedding 001" },
  { modelId: "text-embedding-004", label: "Text Embedding 004" },
  { modelId: "aqa", label: "AQA (Attributed Question Answering)" },
];

const OLLAMA_DEFAULT_MODELS = [
  { modelId: "llama3.1:8b", label: "Llama 3.1 8B" },
  { modelId: "llama3.2-vision:11b", label: "Llama 3.2 Vision 11B" },
  { modelId: "llama3.3:70b", label: "Llama 3.3 70B" },
  { modelId: "llama3:70b", label: "Llama 3 70B" },
  { modelId: "mistral:7b", label: "Mistral 7B" },
  { modelId: "mixtral:8x7b", label: "Mixtral 8x7B" },
  { modelId: "codellama:7b", label: "CodeLlama 7B" },
  { modelId: "gemma2:9b", label: "Gemma 2 9B" },
  { modelId: "phi3:14b", label: "Phi-3 14B" },
  { modelId: "nomic-embed-text", label: "Nomic Embed Text" },
];

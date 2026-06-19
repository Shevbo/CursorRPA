// Каталог моделей портала. Источник истины — здесь (не БД).
// provider должен совпадать с провайдером в Lineman (anthropic/google→gemini/deepseek/lm-studio).
// ВНИМАНИЕ: в Lineman google-провайдер; в портале он зовётся "gemini".
// Маппинг portalProvider→linemanProvider — в toLinemanProvider().

export type ModelTier = "chat" | "think" | "both";
export type CatalogModel = {
  provider: "gemini" | "deepseek" | "anthropic" | "lm-studio";
  modelId: string;
  label: string;
  tier: ModelTier;
};

export const MODEL_CATALOG: CatalogModel[] = [
  { provider: "gemini", modelId: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "chat" },
  { provider: "gemini", modelId: "gemini-3.0-flash", label: "Gemini 3.0 Flash", tier: "chat" },
  { provider: "gemini", modelId: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "think" },
  { provider: "gemini", modelId: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", tier: "think" },
  { provider: "deepseek", modelId: "deepseek-chat", label: "DeepSeek Flash (chat)", tier: "chat" },
  { provider: "deepseek", modelId: "deepseek-reasoner", label: "DeepSeek Pro (reasoner)", tier: "think" },
  { provider: "anthropic", modelId: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "chat" },
  { provider: "anthropic", modelId: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: "both" },
  { provider: "anthropic", modelId: "claude-opus-4-8", label: "Claude Opus 4.8", tier: "think" },
  { provider: "lm-studio", modelId: "qwen3.5-9b", label: "Qwen 3.5 9B (local)", tier: "chat" },
  { provider: "lm-studio", modelId: "deepseek-r1-14b", label: "DeepSeek R1 14B (local)", tier: "think" },
  { provider: "lm-studio", modelId: "gemma-4-26b", label: "Gemma 4 26B (local)", tier: "both" },
];

export function findCatalogModel(provider: string, modelId: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.modelId === modelId);
}

export function parseRoleValue(value: string): { provider: string; modelId: string } | null {
  const i = (value || "").indexOf("/");
  if (i <= 0) return null;
  return { provider: value.slice(0, i), modelId: value.slice(i + 1) };
}

export function isValidRoleValue(value: string): boolean {
  const p = parseRoleValue(value);
  return !!p && !!findCatalogModel(p.provider, p.modelId);
}

/** Значения для dropdown: "provider/modelId". */
export function roleEnumValues(): string[] {
  return MODEL_CATALOG.map((m) => `${m.provider}/${m.modelId}`);
}

/** portalProvider → linemanProvider (Lineman зовёт Gemini как "google"). */
export function toLinemanProvider(portalProvider: string): string {
  return portalProvider === "gemini" ? "google" : portalProvider;
}

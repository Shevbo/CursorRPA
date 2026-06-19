import { parseRoleValue, isValidRoleValue } from "./model-catalog";

const DEFAULTS: Record<"chat" | "think", { provider: string; modelId: string }> = {
  chat: { provider: "gemini", modelId: "gemini-2.5-flash" },
  think: { provider: "gemini", modelId: "gemini-2.5-pro" },
};

/** Чистая функция: резолв роли из произвольного env-словаря (тестируемо). */
export function resolveRoleFromEnv(
  role: "chat" | "think",
  env: Record<string, string | undefined>
): { provider: string; modelId: string } {
  const key = role === "chat" ? "ROLE_CHAT_MODEL" : "ROLE_THINK_MODEL";
  const v = (env[key] || "").trim();
  if (v && isValidRoleValue(v)) {
    return parseRoleValue(v)!;
  }
  return DEFAULTS[role];
}

/** Прод-обёртка над process.env. */
export function resolveRole(role: "chat" | "think") {
  return resolveRoleFromEnv(role, process.env as Record<string, string | undefined>);
}

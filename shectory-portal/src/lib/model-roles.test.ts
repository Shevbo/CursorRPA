import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRoleFromEnv } from "./model-roles";

test("resolveRoleFromEnv читает chat из env", () => {
  const r = resolveRoleFromEnv("chat", { ROLE_CHAT_MODEL: "deepseek/deepseek-chat" });
  assert.deepEqual(r, { provider: "deepseek", modelId: "deepseek-chat" });
});

test("resolveRoleFromEnv фолбэк на дефолт при пустом/невалидном", () => {
  assert.deepEqual(resolveRoleFromEnv("chat", {}), { provider: "gemini", modelId: "gemini-2.5-flash" });
  assert.deepEqual(resolveRoleFromEnv("think", { ROLE_THINK_MODEL: "garbage" }),
    { provider: "gemini", modelId: "gemini-2.5-pro" });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { modelIdToLinemanTarget, runAgentPrompt } from "./agent-cli.mjs";

test("modelId 'gemini/gemini-3.1-pro-preview' → google provider", () => {
  assert.deepEqual(modelIdToLinemanTarget("gemini/gemini-3.1-pro-preview"),
    { provider: "google", model: "gemini-3.1-pro-preview" });
});

test("modelId 'deepseek/deepseek-reasoner' → deepseek", () => {
  assert.deepEqual(modelIdToLinemanTarget("deepseek/deepseek-reasoner"),
    { provider: "deepseek", model: "deepseek-reasoner" });
});

test("голый modelId без провайдера → null (нужен формат provider/model)", () => {
  assert.equal(modelIdToLinemanTarget("gemini-3-flash"), null);
});

test("backend openclaw возвращает явную ошибку, не падает в cursor_cli", async () => {
  const prev = process.env.SHECTORY_EXECUTOR_BACKEND;
  process.env.SHECTORY_EXECUTOR_BACKEND = "openclaw";
  try {
    const r = await runAgentPrompt("/tmp", "hi", 5000, "gemini/gemini-2.5-flash", "executor");
    assert.equal(r.ok, false);
    assert.match(r.stderr, /openclaw/);
  } finally {
    process.env.SHECTORY_EXECUTOR_BACKEND = prev;
  }
});

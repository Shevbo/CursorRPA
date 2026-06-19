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

test("backend openclaw без SHECTORY_PROJECT_SLUG возвращает явную ошибку", async () => {
  const prevBackend = process.env.SHECTORY_EXECUTOR_BACKEND;
  const prevSlug = process.env.SHECTORY_PROJECT_SLUG;
  process.env.SHECTORY_EXECUTOR_BACKEND = "openclaw";
  delete process.env.SHECTORY_PROJECT_SLUG;
  try {
    const r = await runAgentPrompt("/tmp", "hi", 5000, "gemini/gemini-2.5-flash", "executor");
    assert.equal(r.ok, false);
    assert.match(r.stderr, /SHECTORY_PROJECT_SLUG/);
  } finally {
    process.env.SHECTORY_EXECUTOR_BACKEND = prevBackend;
    if (prevSlug === undefined) delete process.env.SHECTORY_PROJECT_SLUG; else process.env.SHECTORY_PROJECT_SLUG = prevSlug;
  }
});

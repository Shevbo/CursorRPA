import { test } from "node:test";
import assert from "node:assert/strict";
import { modelIdToLinemanTarget } from "./agent-cli.mjs";

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

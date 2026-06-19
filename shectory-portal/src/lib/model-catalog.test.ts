import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_CATALOG, findCatalogModel, parseRoleValue, isValidRoleValue } from "./model-catalog";

test("каталог содержит 12 моделей всех провайдеров", () => {
  const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
  assert.ok(providers.has("gemini"));
  assert.ok(providers.has("deepseek"));
  assert.ok(providers.has("anthropic"));
  assert.ok(providers.has("lm-studio"));
  assert.equal(MODEL_CATALOG.length, 12);
});

test("findCatalogModel находит по provider+modelId", () => {
  const m = findCatalogModel("deepseek", "deepseek-reasoner");
  assert.equal(m?.label, "DeepSeek Pro (reasoner)");
});

test("parseRoleValue парсит 'provider/model'", () => {
  assert.deepEqual(parseRoleValue("gemini/gemini-2.5-flash"), {
    provider: "gemini", modelId: "gemini-2.5-flash",
  });
  assert.equal(parseRoleValue("garbage"), null);
});

test("isValidRoleValue требует наличие в каталоге", () => {
  assert.equal(isValidRoleValue("gemini/gemini-2.5-flash"), true);
  assert.equal(isValidRoleValue("gemini/not-real"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpenclawArgs, parseOpenclawJson } from "./openclaw-cli.mjs";

test("buildOpenclawArgs формирует agent-вызов с моделью и json", () => {
  const a = buildOpenclawArgs({ agentId: "portal-demo", message: "hi", modelId: "google/gemini-3.1-pro-preview", timeoutSec: 120 });
  assert.deepEqual(a, ["agent", "--agent", "portal-demo", "--message", "hi", "--model", "google/gemini-3.1-pro-preview", "--json", "--timeout", "120"]);
});

test("buildOpenclawArgs без modelId опускает --model", () => {
  const a = buildOpenclawArgs({ agentId: "portal-demo", message: "hi", timeoutSec: 60 });
  assert.ok(!a.includes("--model"));
  assert.ok(a.includes("--json"));
});

test("parseOpenclawJson извлекает текст ответа из разных ключей", () => {
  assert.equal(parseOpenclawJson(JSON.stringify({ reply: "готово" })), "готово");
  assert.equal(parseOpenclawJson(JSON.stringify({ text: "ok" })), "ok");
  assert.equal(parseOpenclawJson(JSON.stringify({ message: "m" })), "m");
  assert.equal(parseOpenclawJson(JSON.stringify({ content: "c" })), "c");
  assert.equal(parseOpenclawJson("не json"), "");
});

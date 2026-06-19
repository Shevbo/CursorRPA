import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertAgentEntry, projectAgentId } from "./openclaw-agent";

test("projectAgentId санитизирует slug", () => {
  assert.equal(projectAgentId("My Proj!"), "portal-my-proj-");
});

test("upsertAgentEntry добавляет нового агента, не трогая остальных", () => {
  const cfg = { agents: { list: [{ id: "keymaster", workspace: "/x" }] } };
  const out = upsertAgentEntry(cfg, {
    id: "portal-demo", workspace: "/ws/demo",
    primary: "google/gemini-3.1-pro-preview", fallbacks: ["deepseek/deepseek-reasoner"],
  });
  assert.equal(out.agents.list.length, 2);
  assert.ok(out.agents.list.find((a: any) => a.id === "keymaster"));
  const a = out.agents.list.find((a: any) => a.id === "portal-demo");
  assert.equal(a.workspace, "/ws/demo");
  assert.equal(a.model.primary, "google/gemini-3.1-pro-preview");
  assert.deepEqual(a.model.fallbacks, ["deepseek/deepseek-reasoner"]);
});

test("upsertAgentEntry обновляет существующего по id, без дублей", () => {
  const cfg = { agents: { list: [{ id: "portal-demo", workspace: "/old", model: { primary: "x" } }] } };
  const out = upsertAgentEntry(cfg, {
    id: "portal-demo", workspace: "/new", primary: "deepseek/deepseek-chat", fallbacks: [],
  });
  assert.equal(out.agents.list.length, 1);
  assert.equal(out.agents.list[0].workspace, "/new");
  assert.equal(out.agents.list[0].model.primary, "deepseek/deepseek-chat");
});

test("upsertAgentEntry не мутирует исходный cfg", () => {
  const cfg = { agents: { list: [] as any[] } };
  upsertAgentEntry(cfg, { id: "portal-x", workspace: "/w", primary: "google/g", fallbacks: [] });
  assert.equal(cfg.agents.list.length, 0);
});

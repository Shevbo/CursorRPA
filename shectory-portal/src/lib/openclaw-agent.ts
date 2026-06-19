import * as fs from "node:fs";

const OPENCLAW_JSON = process.env.OPENCLAW_CONFIG ?? `${process.env.HOME ?? "/home/shectory"}/.openclaw/openclaw.json`;

export function projectAgentId(slug: string): string {
  return "portal-" + String(slug).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export type AgentSpec = { id: string; workspace: string; primary: string; fallbacks: string[] };

/** Чистая: вернуть НОВЫЙ объект конфига с upsert-записью агента. Не мутирует вход. */
export function upsertAgentEntry(cfg: any, spec: AgentSpec): any {
  const next = JSON.parse(JSON.stringify(cfg ?? {}));
  next.agents = next.agents ?? {};
  next.agents.list = Array.isArray(next.agents.list) ? next.agents.list : [];
  const entry = {
    id: spec.id,
    name: spec.id,
    workspace: spec.workspace,
    model: { primary: spec.primary, fallbacks: spec.fallbacks, timeoutMs: 120000 },
  };
  const i = next.agents.list.findIndex((a: any) => a && a.id === spec.id);
  if (i >= 0) {
    next.agents.list[i] = { ...next.agents.list[i], ...entry, model: entry.model };
  } else {
    next.agents.list.push(entry);
  }
  return next;
}

/** I/O: прочитать openclaw.json, upsert, записать с backup (atomic). Идемпотентно. */
export function ensureProjectAgent(opts: { slug: string; workspace: string; primary: string; fallbacks: string[] }): { id: string } {
  const id = projectAgentId(opts.slug);
  const raw = fs.readFileSync(OPENCLAW_JSON, "utf8");
  const cfg = JSON.parse(raw);
  const next = upsertAgentEntry(cfg, { id, workspace: opts.workspace, primary: opts.primary, fallbacks: opts.fallbacks });
  fs.writeFileSync(OPENCLAW_JSON + ".bak", raw, { mode: 0o600 });
  const tmp = OPENCLAW_JSON + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, OPENCLAW_JSON);
  return { id };
}

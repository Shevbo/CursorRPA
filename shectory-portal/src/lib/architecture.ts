import { Prisma, type Project } from "@prisma/client";

function asciiLabel(input: unknown): string {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function mermaidId(input: unknown, fallback: string): string {
  const raw = String(input ?? "").toLowerCase();
  const id = raw.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return id || fallback;
}

function nodeDecl(id: string, label: string): string {
  return `    ${id}["${label}"]`;
}

export type RegistryServer = {
  id?: string;
  name?: string;
  role?: string;
  host?: string;
  group?: string;
};

export type RegistryModule = {
  id?: string;
  name?: string;
  kind?: string;
  serverId?: string;
  server?: string;
  version?: string;
  status?: string;
};

export type RegistryFlow = {
  from?: string;
  to?: string;
  label?: string;
};

export type RegistryMeta = {
  servers?: RegistryServer[];
  modules?: RegistryModule[];
  flows?: RegistryFlow[];
};

export function buildArchitectureMermaid(project: Pick<Project, "slug" | "name" | "registryMetaJson">): string {
  const meta = asObject(project.registryMetaJson) as unknown as RegistryMeta | null;
  const servers = (meta?.servers ?? []).filter(Boolean);
  const modules = (meta?.modules ?? []).filter(Boolean);
  const flows = (meta?.flows ?? []).filter(Boolean);

  // fallback if no registry metadata
  if (!servers.length && !modules.length && !flows.length) {
    const nodeId = project.slug.replace(/[^a-z0-9]/g, "") || "Project";
    const label = asciiLabel(project.name) || project.slug;
    // Use quoted label form for best compatibility.
    return `flowchart LR\n  ${nodeId}["${label}"]`;
  }

  const serverIds = new Map<RegistryServer, string>();
  for (const s of servers) {
    const sid = mermaidId(s.id || s.name || s.host || "server", "server");
    serverIds.set(s, `srv_${sid}`);
  }

  const moduleByKey = new Map<string, { nodeId: string; label: string; module: RegistryModule }>();
  for (const m of modules) {
    const mid = mermaidId(m.id || m.name || "module", "module");
    const key = String(m.id || m.name || mid);
    const label = asciiLabel(m.name || m.id || key) || key;
    moduleByKey.set(key, { nodeId: `mod_${mid}`, label, module: m });
  }

  const lines: string[] = [];
  lines.push("flowchart TB");

  const groups = new Map<string, RegistryServer[]>();
  for (const s of servers) {
    const g = asciiLabel(s.group || s.role || "Servers") || "Servers";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }
  if (groups.size === 0) groups.set("Servers", []);

  const groupEntries = Array.from(groups.entries());
  for (const [gname, sList] of groupEntries) {
    const gid = mermaidId(gname, "group");
    lines.push(`  subgraph ${gid}["${gname}"]`);
    for (const s of sList) {
      const sid = serverIds.get(s)!;
      const parts = [];
      if (s.name) parts.push(asciiLabel(s.name));
      if (s.role) parts.push(`(${asciiLabel(s.role)})`);
      if (s.host) parts.push(asciiLabel(s.host));
      lines.push(nodeDecl(sid, parts.filter(Boolean).join(" ") || "server"));

      const sKey = String(s.id || s.name || s.host || "");
      const modForServer = modules.filter((m) => String(m.serverId || m.server || "") === sKey);
      for (const m of modForServer) {
        const key = String(m.id || m.name || mermaidId(m.name, "module"));
        const entry = moduleByKey.get(key);
        if (!entry) continue;
        const suffix: string[] = [];
        if (m.version) suffix.push(`v${asciiLabel(m.version)}`);
        if (m.status) suffix.push(asciiLabel(m.status));
        const mLabel = [entry.label, suffix.length ? `(${suffix.join(", ")})` : ""].filter(Boolean).join(" ");
        lines.push(`    ${entry.nodeId}["${mLabel}"]`);
        lines.push(`    ${sid} --> ${entry.nodeId}`);
      }
    }
    lines.push("  end");
  }

  if (!servers.length && modules.length) {
    lines.push('  subgraph modules["Modules"]');
    const moduleEntries = Array.from(moduleByKey.values());
    for (const entry of moduleEntries) lines.push(`    ${entry.nodeId}["${entry.label}"]`);
    lines.push("  end");
  }

  lines.push('  subgraph ext["External"]');
  lines.push('    web["Users/Browser"]');
  lines.push('    gh["GitHub"]');
  lines.push('    tg["Telegram"]');
  lines.push("  end");

  for (const f of flows) {
    const fromKey = String(f.from || "");
    const toKey = String(f.to || "");
    const from = moduleByKey.get(fromKey)?.nodeId;
    const to = moduleByKey.get(toKey)?.nodeId;
    if (!from || !to) continue;
    const label = f.label ? asciiLabel(f.label) : "";
    lines.push(label ? `  ${from} -- "${label}" --> ${to}` : `  ${from} --> ${to}`);
  }

  if (!flows.length) {
    const ui = modules.find((m) => String(m.kind || "").toLowerCase().includes("ui"));
    if (ui) {
      const key = String(ui.id || ui.name);
      const nid = moduleByKey.get(key)?.nodeId;
      if (nid) lines.push(`  web --> ${nid}`);
    }
  }

  return lines.join("\n");
}

export function coerceRegistryMetaJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  // API accepts anything JSON-serializable; this is a narrow helper for type safety.
  JSON.stringify(value);
  return value as Prisma.InputJsonValue;
}


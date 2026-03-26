import { PrismaClient } from "@prisma/client";

/**
 * Refresh Project.architectureMermaid for better, consistent visualization.
 * Run on VDS with env DATABASE_URL (pointing to Hoster DB).
 *
 * Example:
 *   cd /home/shectory/workspaces/CursorRPA/shectory-portal
 *   set -a && source .env && set +a
 *   node ../scripts/refresh-architecture-on-vds.mjs
 */

const prisma = new PrismaClient();

function asciiLabel(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function mermaidId(input, fallback) {
  const raw = String(input || "").toLowerCase();
  const id = raw.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return id || fallback;
}

function nodeDecl(id, label) {
  // label should be ASCII-safe
  return `    ${id}["${label}"]`;
}

/**
 * registryMetaJson contract (flexible, but generator expects these shapes):
 * {
 *   servers: [{ id, name, role, host, group, links: [{label,url}] }],
 *   modules: [{ id, name, kind, serverId, version, status }],
 *   flows: [{ from, to, label? }]
 * }
 */
function architectureFromRegistry(p, meta) {
  const servers = asArray(meta.servers).map(asObject).filter(Boolean);
  const modules = asArray(meta.modules).map(asObject).filter(Boolean);
  const flows = asArray(meta.flows).map(asObject).filter(Boolean);

  // Build maps
  const serverIds = new Map();
  for (const s of servers) {
    const sid = mermaidId(s.id || s.name || s.host || "server", "server");
    serverIds.set(s, `srv_${sid}`);
  }

  const moduleByKey = new Map(); // key -> { id,label,serverNode? }
  for (const m of modules) {
    const mid = mermaidId(m.id || m.name || "module", "module");
    const key = String(m.id || m.name || mid);
    const label = asciiLabel(m.name || m.id || key) || key;
    const nodeId = `mod_${mid}`;
    moduleByKey.set(key, { nodeId, label, module: m });
  }

  const lines = [];
  lines.push("flowchart TB");

  // Group servers (default groups)
  const groups = new Map(); // groupName -> [server]
  for (const s of servers) {
    const g = asciiLabel(s.group || s.platform || s.role || "Servers") || "Servers";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  if (groups.size === 0) groups.set("Servers", []);

  // Render server subgraphs
  for (const [gname, sList] of groups.entries()) {
    const gid = mermaidId(gname, "group");
    lines.push(`  subgraph ${gid}["${gname}"]`);
    for (const s of sList) {
      const sid = serverIds.get(s);
      const sLabelParts = [];
      if (s.name) sLabelParts.push(asciiLabel(s.name));
      if (s.role) sLabelParts.push(`(${asciiLabel(s.role)})`);
      if (s.host) sLabelParts.push(asciiLabel(s.host));
      const sLabel = sLabelParts.filter(Boolean).join(" ");
      lines.push(nodeDecl(sid, sLabel || "server"));

      // Modules on this server
      const sKey = String(s.id || s.name || s.host || "");
      const modForServer = modules.filter((m) => String(m.serverId || m.server || "") === sKey);
      for (const m of modForServer) {
        const key = String(m.id || m.name || mermaidId(m.name, "module"));
        const entry = moduleByKey.get(key);
        if (!entry) continue;
        const suffix = [];
        if (m.version) suffix.push(`v${asciiLabel(m.version)}`);
        if (m.status) suffix.push(asciiLabel(m.status));
        const mLabel = [entry.label, suffix.length ? `(${suffix.join(", ")})` : ""].filter(Boolean).join(" ");
        // indent + module node
        lines.push(`    ${entry.nodeId}["${mLabel}"]`);
        // link server -> module (containment edge)
        lines.push(`    ${sid} --> ${entry.nodeId}`);
      }
    }
    lines.push("  end");
  }

  // If there are modules but no servers, render modules in a module-only group.
  if (servers.length === 0 && modules.length > 0) {
    lines.push('  subgraph modules["Modules"]');
    for (const entry of moduleByKey.values()) {
      lines.push(`    ${entry.nodeId}["${entry.label}"]`);
    }
    lines.push("  end");
  }

  // External baseline nodes (always useful)
  lines.push('  subgraph ext["External"]');
  lines.push('    web["Users/Browser"]');
  lines.push('    gh["GitHub"]');
  lines.push('    tg["Telegram"]');
  lines.push("  end");

  // Flow edges
  for (const f of flows) {
    const fromKey = String(f.from || "");
    const toKey = String(f.to || "");
    const from = moduleByKey.get(fromKey)?.nodeId || mermaidId(fromKey, "");
    const to = moduleByKey.get(toKey)?.nodeId || mermaidId(toKey, "");
    if (!from || !to) continue;
    const label = f.label ? asciiLabel(f.label) : "";
    lines.push(label ? `  ${from} -- "${label}" --> ${to}` : `  ${from} --> ${to}`);
  }

  // Helpful default flows if nothing specified
  if (flows.length === 0) {
    // try to connect web to something UI-ish
    const ui = modules.find((m) => String(m.kind || "").toLowerCase().includes("ui"));
    if (ui) {
      const key = String(ui.id || ui.name);
      const nid = moduleByKey.get(key)?.nodeId;
      if (nid) lines.push(`  web --> ${nid}`);
    }
  }

  return lines.join("\n");
}

function architectureForProject(p) {
  const slug = p.slug;
  const name = asciiLabel(p.name) || slug;

  const meta = asObject(p.registryMetaJson);
  if (meta && (Array.isArray(meta.servers) || Array.isArray(meta.modules) || Array.isArray(meta.flows))) {
    try {
      return architectureFromRegistry(p, meta);
    } catch (e) {
      // fall through to default
      console.error(`WARN: registry architecture failed for ${slug}:`, String(e).slice(0, 200));
    }
  }

  // Fallback: small but valid diagram
  const nodeId = slug.replace(/[^a-z0-9]/g, "") || "Project";
  return `flowchart LR\n  ${nodeId}["${name}"]`;
}

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, slug: true, name: true, registryMetaJson: true },
    orderBy: { slug: "asc" },
  });

  let updated = 0;
  for (const p of projects) {
    const chart = architectureForProject(p);
    await prisma.project.update({
      where: { id: p.id },
      data: { architectureMermaid: chart },
    });
    updated += 1;
  }

  console.log(`OK: updated architectureMermaid for ${updated} projects`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


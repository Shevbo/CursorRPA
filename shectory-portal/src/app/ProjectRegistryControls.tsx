"use client";

import { useState } from "react";

type SyncResult = {
  ok: boolean;
  scanned: number;
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
};

type CreateResult = {
  slug: string;
  workspacePath: string;
  sshCommand: string;
  workspaceReady: boolean;
  gitReady: boolean;
  sshReady: boolean;
  repoUrl: string | null;
  remoteCreated: boolean;
  warnings: string[];
  gitStatusSummary: string;
};

export function ProjectRegistryControls() {
  const [syncLoading, setSyncLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string>("");

  const [slug, setSlug] = useState("pingmaster");
  const [name, setName] = useState("PingMaster");
  const [repoName, setRepoName] = useState("pingmaster");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [owner, setOwner] = useState("shectory");
  const [maintainer, setMaintainer] = useState("shectory");
  const [docsUrl, setDocsUrl] = useState("");
  const [stage, setStage] = useState("dev");

  async function runSync() {
    setError("");
    setSyncLoading(true);
    try {
      const res = await fetch("/api/projects/sync", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync failed");
      setSyncResult(json.result as SyncResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncLoading(false);
    }
  }

  async function createProject() {
    setError("");
    setCreateLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          repoName,
          visibility,
          owner,
          maintainer: maintainer || undefined,
          stage,
          status: "active",
          docsUrl: docsUrl || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "create failed");
      setCreateResult(json.result as CreateResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        Project Registry Controls
      </h2>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={syncLoading}
          onClick={runSync}
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          {syncLoading ? "Sync..." : "Sync workspaces"}
        </button>
      </div>

      {syncResult && (
        <div className="mt-3 rounded border border-slate-800 bg-black/20 p-3 text-xs text-slate-300">
          scanned={syncResult.scanned} synced={syncResult.synced} created={syncResult.created} updated=
          {syncResult.updated} skipped={syncResult.skipped}
          {syncResult.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-300">
              {syncResult.warnings.map((w, i) => (
                <li key={`${w}-${i}`}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="slug"
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={repoName}
          onChange={(e) => setRepoName(e.target.value)}
          placeholder="repoName"
        />
        <select
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "private" | "public")}
        >
          <option value="private">private</option>
          <option value="public">public</option>
        </select>
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="owner"
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={maintainer}
          onChange={(e) => setMaintainer(e.target.value)}
          placeholder="maintainer (optional)"
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={docsUrl}
          onChange={(e) => setDocsUrl(e.target.value)}
          placeholder="docsUrl (optional)"
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          placeholder="stage"
        />
      </div>

      <div className="mt-3">
        <button
          type="button"
          disabled={createLoading}
          onClick={createProject}
          className="rounded bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          {createLoading ? "Creating..." : "Create project"}
        </button>
      </div>

      {createResult && (
        <div className="mt-3 rounded border border-slate-800 bg-black/20 p-3 text-xs text-slate-300">
          <div>slug: {createResult.slug}</div>
          <div>workspace: {createResult.workspacePath}</div>
          <div>ssh: {createResult.sshCommand}</div>
          <div>repo: {createResult.repoUrl ?? "not configured"}</div>
          <div>
            readiness: workspace={String(createResult.workspaceReady)} git={String(createResult.gitReady)} ssh=
            {String(createResult.sshReady)}
          </div>
          <div>git status: {createResult.gitStatusSummary}</div>
          {!createResult.remoteCreated && (
            <div className="mt-1 text-amber-300">warning: remote repo was not created.</div>
          )}
          {createResult.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-300">
              {createResult.warnings.map((w, i) => (
                <li key={`${w}-${i}`}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
    </section>
  );
}

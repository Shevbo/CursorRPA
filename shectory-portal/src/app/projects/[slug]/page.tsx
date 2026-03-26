import Link from "next/link";
import { notFound } from "next/navigation";
import { adminSessionOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { MermaidBlock } from "@/components/MermaidBlock";
import { ProjectDescriptionEditor } from "@/components/ProjectDescriptionEditor";
import { RefreshArchitectureButton } from "@/components/RefreshArchitectureButton";
import { ProjectWorkspace } from "./ProjectWorkspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: { slug: string } }) {
  const project = await prisma.project.findUnique({
    where: { slug: params.slug },
    include: {
      techStack: { orderBy: { sortOrder: "asc" } },
      chats: { include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } } },
    },
  });
  if (!project) notFound();

  const canEditDescriptions = adminSessionOk();
  const modVers = project.moduleVersionsJson as Record<string, string> | null;
  const meta = project.registryMetaJson as ({
    hosterRole?: string;
    stack?: string[];
    notes?: string;
    servers?: Array<{ name?: string; role?: string; host?: string; links?: Array<{ label: string; url: string }> }>;
    modules?: Array<{ name?: string; status?: string; version?: string; host?: string }>;
    secrets?: { hint?: string };
  } | null);

  const assistantPrompt = [
    `Проект: ${project.name} (${project.slug})`,
    project.uiUrl ? `UI: ${project.uiUrl}` : "UI: -",
    project.repoUrl ? `Repo: ${project.repoUrl}` : "Repo: -",
    `Workspace: ${project.workspacePath}`,
    "",
    "Сформируй команды и ссылки для администрирования проекта (НЕ раскрывая секреты):",
    "- где лежат env/secret-файлы, какие ключи искать (Hoster/VDS)",
    "- как проверить статусы модулей (systemd/docker/psql) на нужных серверах",
    "- как открыть pgAdmin/psql и где смотреть роли/права",
  ].join("\n");

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/" className="text-sm text-blue-400 hover:underline">
          ← Все проекты
        </Link>
        <Link
          href={`/projects/${project.slug}/control`}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Панель управления
        </Link>
      </div>

      {/* Верхняя треть — карточка */}
      <section className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="text-xs text-slate-500">ID: {project.id}</div>
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          <ProjectDescriptionEditor
            slug={project.slug}
            initialDescription={project.description}
            canEdit={canEditDescriptions}
            variant="full"
          />
          <div className="flex flex-wrap gap-2 text-sm">
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Репозиторий
              </a>
            )}
            {project.uiUrl && (
              <a
                href={project.uiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                UI
              </a>
            )}
            {project.docsUrl && (
              <a
                href={project.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Документация
              </a>
            )}
            <span className="text-slate-500">·</span>
            <span className="text-slate-400">workspace: {project.workspacePath}</span>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <a
              href={`/projects/${project.slug}/assistant?prompt=${encodeURIComponent(assistantPrompt)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900"
            >
              Спросить агента (админ-команды)
            </a>
          </div>

          <RefreshArchitectureButton slug={project.slug} />
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-slate-800 px-2 py-1">owner: {project.owner ?? "-"}</span>
            <span className="rounded bg-slate-800 px-2 py-1">maintainer: {project.maintainer ?? "-"}</span>
            <span className="rounded bg-slate-800 px-2 py-1">stage: {project.stage}</span>
            <span className="rounded bg-slate-800 px-2 py-1">status: {project.status}</span>
            <span className={`rounded px-2 py-1 ${project.workspaceReady ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>
              workspace: {project.workspaceReady ? "ready" : "check"}
            </span>
            <span className={`rounded px-2 py-1 ${project.gitReady ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>
              git: {project.gitReady ? "ready" : "check"}
            </span>
            <span className={`rounded px-2 py-1 ${project.sshReady ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>
              ssh: {project.sshReady ? "ready" : "check"}
            </span>
          </div>
          <div className="rounded border border-slate-800 bg-black/30 p-3 text-xs text-slate-300">
            <div>SSH: <span className="text-green-400">ssh shectory-work</span></div>
            <div>cd: <span className="text-slate-100">{project.workspacePath}</span></div>
            <div className="mt-1">handoff endpoint: <span className="text-blue-300">/api/projects/{project.slug}/handoff</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded bg-slate-800 px-2 py-1 text-xs">v{project.version}</span>
            {modVers &&
              Object.entries(modVers).map(([k, v]) => (
                <span key={k} className="rounded bg-slate-800 px-2 py-1 text-xs">
                  {k}: {v}
                </span>
              ))}
            {project.lastDeployedAt && (
              <span className="text-xs text-slate-500">
                Последний prod: {project.lastDeployedAt.toISOString().slice(0, 19)}Z
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            {project.boardUrl && (
              <a href={project.boardUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                board
              </a>
            )}
            {project.runbookUrl && (
              <a href={project.runbookUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                runbook
              </a>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-400">Стек</h3>
            <ul className="flex flex-wrap gap-2">
              {project.techStack.map((t) => (
                <li key={t.id}>
                  <a
                    href={t.vendorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1 text-sm text-blue-300 hover:border-blue-500"
                  >
                    {t.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-400">Контекст для ИИ</h3>
            <pre className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/30 p-4 text-sm text-slate-300">
              {project.aiContext}
            </pre>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-800 bg-black/20 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Инфраструктура</h3>
            {meta?.hosterRole && <div className="text-sm text-slate-300">hoster_role: {meta.hosterRole}</div>}
            {meta?.notes && <div className="whitespace-pre-wrap text-sm text-slate-300">{meta.notes}</div>}

            {Array.isArray(meta?.stack) && meta!.stack!.length > 0 && (
              <div>
                <div className="text-xs text-slate-500">stack</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {meta!.stack!.map((s) => (
                    <span key={s} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(meta?.servers) && meta!.servers!.length > 0 && (
              <div>
                <div className="text-xs text-slate-500">servers</div>
                <ul className="mt-2 space-y-2 text-sm">
                  {meta!.servers!.map((s, i) => (
                    <li key={`${s.name ?? "server"}-${i}`} className="rounded border border-slate-800 bg-slate-900/30 p-3">
                      <div className="font-medium text-slate-200">{s.name ?? "server"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {s.role ? `role: ${s.role}` : ""} {s.host ? `host: ${s.host}` : ""}
                      </div>
                      {Array.isArray(s.links) && s.links.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs">
                          {s.links.map((l) => (
                            <a
                              key={`${l.label}-${l.url}`}
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                            >
                              {l.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(meta?.modules) && meta!.modules!.length > 0 && (
              <div>
                <div className="text-xs text-slate-500">modules</div>
                <ul className="mt-2 space-y-2 text-sm">
                  {meta!.modules!.map((m, i) => (
                    <li key={`${m.name ?? "module"}-${i}`} className="rounded border border-slate-800 bg-slate-900/30 p-3">
                      <div className="font-medium text-slate-200">{m.name ?? "module"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {m.status ? `status: ${m.status}` : ""} {m.version ? `version: ${m.version}` : ""}{" "}
                        {m.host ? `host: ${m.host}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {meta?.secrets?.hint && (
              <div className="text-xs text-slate-500">
                secrets: <span className="text-slate-300">{meta.secrets.hint}</span>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-400">Архитектура (mind map)</h3>
          <MermaidBlock chart={project.architectureMermaid} />
        </div>
      </section>

      <section className="mt-10 min-h-[480px] rounded-xl border border-slate-800 bg-slate-900/20 p-4">
        <h2 className="mb-4 text-lg font-semibold text-white">Панель управления (workspace)</h2>
        <ProjectWorkspace
          projectSlug={project.slug}
          projectId={project.id}
          workspacePath={project.workspacePath}
          initialSessions={project.chats}
        />
      </section>
    </main>
  );
}

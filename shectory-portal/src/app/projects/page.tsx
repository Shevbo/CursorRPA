import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { adminSessionOk } from "@/lib/admin-auth";
import { ProjectDescriptionEditor } from "@/components/ProjectDescriptionEditor";
import { LogoutButton } from "@/components/LogoutButton";
import { CreateProjectButton } from "@/components/CreateProjectButton";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const canEditDescriptions = adminSessionOk();

  const [projects, categories] = await Promise.all([
    prisma.project.findMany({
      orderBy: [{ stage: "asc" }, { name: "asc" }],
      include: { techStack: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.referenceCategory.findMany({
      include: { items: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-slate-800 bg-slate-900/50 text-base font-semibold text-white">
            S
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Shectory</h1>
            <p className="mt-0.5 text-slate-400">Панель управления · проекты</p>
          </div>
        </div>
        <div className="flex gap-2">
          <CreateProjectButton canCreate={canEditDescriptions} />
          <LogoutButton />
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">Справочники</h2>
        <div className="flex flex-wrap gap-4">
          {categories.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm"
            >
              <div className="font-medium text-slate-300">{c.name}</div>
              <ul className="mt-2 space-y-1 text-slate-400">
                {c.items.map((i) => (
                  <li key={i.id}>
                    <span className="text-slate-500">{i.label}:</span> {i.value}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">Проекты</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5 shadow-lg transition hover:border-blue-500/40 hover:shadow-blue-900/20"
            >
              <Link href={`/projects/${p.slug}`} className="block outline-none">
                <div className="text-xs text-slate-500">#{p.id.slice(0, 8)}</div>
                <h3 className="mt-1 text-lg font-semibold text-white group-hover:text-blue-400">
                  {p.name}
                </h3>
              </Link>
              <ProjectDescriptionEditor
                slug={p.slug}
                initialDescription={p.description}
                canEdit={canEditDescriptions}
                variant="compact"
              />
              <Link
                href={`/projects/${p.slug}`}
                className="mt-2 block text-xs text-slate-500 hover:text-slate-400"
              >
                {p.workspacePath}
              </Link>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">stage: {p.stage}</span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">status: {p.status}</span>
                <span
                  className={`rounded px-2 py-0.5 ${
                    p.workspaceReady ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"
                  }`}
                >
                  ws: {p.workspaceReady ? "ready" : "check"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 ${
                    p.gitReady ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"
                  }`}
                >
                  git: {p.gitReady ? "ready" : "check"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 ${
                    p.sshReady ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"
                  }`}
                >
                  ssh: {p.sshReady ? "ready" : "check"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">v{p.version}</span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">source: {p.createdSource}</span>
                {p.lastDeployedAt && (
                  <span className="text-slate-500">prod: {p.lastDeployedAt.toISOString().slice(0, 10)}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {p.repoUrl && (
                  <a href={p.repoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                    repo
                  </a>
                )}
                {p.docsUrl && (
                  <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                    docs
                  </a>
                )}
                {p.boardUrl && (
                  <a href={p.boardUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                    board
                  </a>
                )}
                {p.runbookUrl && (
                  <a
                    href={p.runbookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    runbook
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}


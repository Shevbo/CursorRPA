import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BacklogPanel } from "@/components/BacklogPanel";
import { NotificationBell } from "@/components/NotificationBell";
import { prismaStudioUrlFromRegistryMeta } from "@/lib/project-devtools";
import { AssistBotAllowlistPanel } from "@/components/AssistBotAllowlistPanel";

export const dynamic = "force-dynamic";

export default async function ProjectControlPage({ params }: { params: { slug: string } }) {
  const project = await prisma.project.findUnique({
    where: { slug: params.slug },
  });
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-blue-400 hover:underline">
            ← Все проекты
          </Link>
          <Link href={`/projects/${project.slug}`} className="ml-4 text-sm text-blue-400 hover:underline">
            ← Карточка проекта
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-white">Панель управления</h1>
          <p className="mt-1 text-slate-400">{project.name}</p>
        </div>
        <NotificationBell />
      </div>

      {(() => {
        const prismaUrl = prismaStudioUrlFromRegistryMeta(project.registryMetaJson);
        if (!prismaUrl) return null;
        return (
          <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">Инструменты БД</h2>
            <a
              href={prismaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/50 touch-manipulation"
            >
              Prisma Studio (в приложении проекта)
            </a>
            <p className="mt-2 text-xs text-slate-500">
              Открывается UI прикладного проекта; доступ по сессии администратора этого приложения.
            </p>
          </section>
        );
      })()}

      {project.slug === "shectory-assist" ? <AssistBotAllowlistPanel projectSlug={project.slug} /> : null}

      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Бэклог</h2>
        <BacklogPanel projectId={project.id} projectSlug={project.slug} variant="control" />
      </section>
    </main>
  );
}

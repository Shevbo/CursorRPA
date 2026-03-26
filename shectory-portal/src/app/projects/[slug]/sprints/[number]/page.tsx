import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SprintView } from "@/components/SprintView";

export const dynamic = "force-dynamic";

export default async function SprintPage({ params }: { params: { slug: string; number: string } }) {
  const project = await prisma.project.findUnique({ where: { slug: params.slug }, select: { id: true, slug: true, name: true } });
  if (!project) notFound();

  const n = parseInt(params.number, 10);
  if (!Number.isFinite(n) || n <= 0) notFound();

  const sprint = await prisma.sprint.findUnique({
    where: { projectId_number: { projectId: project.id, number: n } },
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={`/projects/${project.slug}/control`} className="text-blue-400 hover:underline">
            ← Панель управления
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">{project.name}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-200">Sprint #{n}</span>
        </div>
      </div>

      <SprintView
        projectId={project.id}
        projectSlug={project.slug}
        sprintNumber={n}
        initialSprint={(sprint ?? null) as unknown as Record<string, unknown> | null}
      />
    </main>
  );
}


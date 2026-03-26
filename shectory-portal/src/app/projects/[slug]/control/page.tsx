import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BacklogPanel } from "@/components/BacklogPanel";

export const dynamic = "force-dynamic";

export default async function ProjectControlPage({ params }: { params: { slug: string } }) {
  const project = await prisma.project.findUnique({
    where: { slug: params.slug },
  });
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
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
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Бэклог</h2>
        <BacklogPanel projectId={project.id} projectSlug={project.slug} variant="control" />
      </section>
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BacklogTicketView } from "@/components/BacklogTicketView";
import { NotificationBell } from "@/components/NotificationBell";

export const dynamic = "force-dynamic";

export default async function BacklogTicketPage({ params }: { params: { slug: string; id: string } }) {
  const project = await prisma.project.findUnique({
    where: { slug: params.slug },
    select: {
      id: true,
      slug: true,
      name: true,
      aiContext: true,
      techStack: { orderBy: { sortOrder: "asc" }, select: { name: true } },
    },
  });
  if (!project) notFound();

  const item = await prisma.backlogItem.findUnique({
    where: { id: params.id },
    include: {
      sprint: true,
      chats: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 200,
          },
        },
      },
    },
  });
  if (!item || item.projectId !== project.id) notFound();

  const rawSession = item.chats[0] ?? null;
  const initialSession = rawSession
    ? {
        ...rawSession,
        messages: [...rawSession.messages].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        ),
      }
    : null;

  const initialAgentRun = await prisma.agentRun.findFirst({
    where: { backlogItemId: item.id, kind: "backlog_ticket_start" },
    orderBy: { createdAt: "desc" },
    include: { steps: { orderBy: { index: "asc" } } },
  });

  return (
    <main className="mx-auto flex h-dvh max-h-dvh min-h-0 w-full max-w-6xl flex-col overflow-x-hidden overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <div className="mb-2 shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={`/projects/${project.slug}/control`} className="text-blue-400 hover:underline">
            ← Бэклог
          </Link>
          <Link href={`/projects/${project.slug}`} className="text-blue-400 hover:underline">
            Карточка проекта
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">{project.name}</span>
        </div>
        <NotificationBell />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]">
        <BacklogTicketView
          projectId={project.id}
          projectSlug={project.slug}
          itemId={item.id}
          projectAiContext={project.aiContext}
          projectTechStack={project.techStack.map((t) => t.name)}
          initialItem={item as unknown as Record<string, unknown>}
          initialSession={initialSession as unknown as Record<string, unknown> | null}
          initialAgentRun={initialAgentRun as unknown as Record<string, unknown> | null}
        />
      </div>
    </main>
  );
}


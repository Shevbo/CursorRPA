import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

function sse(data: unknown, event?: string): string {
  const payload = JSON.stringify(data);
  return `${event ? `event: ${event}\n` : ""}data: ${payload}\n\n`;
}

export async function GET(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return new Response(sse({ error: "Unauthorized" }, "error"), { status: 401 });

  const url = new URL(req.url);
  const afterSeq = Number(url.searchParams.get("afterSeq") || "0") || 0;

  const runId = params.id;
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  if (!run) return new Response(sse({ error: "Not found" }, "error"), { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      // initial snapshot
      write(sse({ run, afterSeq }, "snapshot"));

      let lastSeq = afterSeq;
      const tick = async () => {
        if (closed) return;
        try {
          const events = await prisma.agentRunEvent.findMany({
            where: { runId, seq: { gt: lastSeq } },
            orderBy: { seq: "asc" },
            take: 200,
          });
          for (const e of events) {
            lastSeq = Math.max(lastSeq, e.seq);
            write(sse(e, "event"));
          }

          // lightweight run status refresh (steps can change)
          const run2 = await prisma.agentRun.findUnique({
            where: { id: runId },
            include: { steps: { orderBy: { index: "asc" } } },
          });
          if (run2) write(sse({ run: run2, lastSeq }, "run"));
        } catch (e) {
          write(sse({ error: e instanceof Error ? e.message : String(e) }, "error"));
        } finally {
          setTimeout(() => void tick(), 1000);
        }
      };

      void tick();

      // keepalive ping
      const ping = setInterval(() => {
        if (closed) return;
        write(`event: ping\ndata: {}\n\n`);
      }, 15000);

      // stop interval on close
      (req as any).signal?.addEventListener?.("abort", () => {
        clearInterval(ping);
        closed = true;
        controller.close();
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}


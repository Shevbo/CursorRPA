import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { clearAgentPidFile, readAgentPidFile } from "@/lib/agent-session-pid";

type Ctx = { params: { id: string } };

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* ignore */
    }
  }
}

export async function POST(req: Request, { params }: Ctx) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await prisma.chatSession.findUnique({ where: { id: params.id } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.chatSession.update({
    where: { id: params.id },
    data: { isStopped: true, stoppedAt: new Date(), updatedAt: new Date() },
  });

  const pid = await readAgentPidFile(params.id);
  if (pid === null) {
    return NextResponse.json({ ok: true, stopped: false, message: "Нет активного процесса оркестратора для этой сессии." });
  }

  killProcessGroup(pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  try {
    process.kill(pid, 0);
    killProcessGroup(pid, "SIGKILL");
  } catch {
    /* process gone */
  }

  await clearAgentPidFile(params.id);

  await prisma.chatMessage.create({
    data: {
      sessionId: params.id,
      role: "assistant",
      content:
        "### Остановка\n\nАвтопроцессы по этой сессии **остановлены** (стоп-флаг + сигнал завершения). " +
        "Новые автозапуски исполнителя/аудитора/команд для сессии блокируются до ручного возобновления.",
    },
  });
  await prisma.chatSession.update({ where: { id: params.id }, data: { updatedAt: new Date() } });

  return NextResponse.json({ ok: true, stopped: true, pid });
}

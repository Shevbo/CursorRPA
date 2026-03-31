import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { runAgentPrompt } from "./lib/agent-cli.mjs";
import { shectoryWikiPreamble } from "./lib/shectory-wiki.mjs";

const prisma = new PrismaClient();
const WAITING_CODE = "[***waiting for answer***]";
const EXECUTOR_MODEL_ID = (process.env.SHECTORY_EXECUTOR_AGENT_MODEL_ID || "claude-4.6-sonnet-medium").trim();

function now() {
  return new Date();
}

function looksLikeWaiting(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.includes(WAITING_CODE)) return true;
  return (
    /\?\s*$/.test(t) ||
    /\b(уточните|уточнение|ответьте|ответ|подтвердите|выберите|нужно уточнить|как лучше|какой вариант|предпочитаете)\b/i.test(t)
  );
}

async function nextSeq(runId) {
  const last = await prisma.agentRunEvent.findFirst({
    where: { runId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (last?.seq ?? 0) + 1;
}

async function emit(runId, type, message = "", data = null) {
  const seq = await nextSeq(runId);
  await prisma.agentRunEvent.create({
    data: { runId, seq, type, message, data: data ?? undefined },
  });
  await prisma.agentRun.update({ where: { id: runId }, data: { lastHeartbeatAt: now() } });
}

async function setStep(runId, index, patch) {
  await prisma.agentRunStep.update({
    where: { runId_index: { runId, index } },
    data: patch,
  });
}

function hashPrompt(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function ruBlock() {
  return (
    shectoryWikiPreamble() +
    "\n\n━━ ЯЗЫК И ФОРМАТ ━━\n" +
    "- Весь связный текст в ответе — ТОЛЬКО на русском.\n" +
    "- Не используй английские вводные.\n" +
    "- Если нужен ответ человека — в КОНЦЕ добавь строку: [***waiting for answer***] и остановись.\n" +
    "- Если хочешь выполнить терминальную команду, НИЧЕГО не запускай сам. Вместо этого выведи блок(и):\n" +
    "<<<SHELL_COMMAND>>>\n" +
    "команда\n" +
    "<<<\/SHELL_COMMAND>>>\n" +
    "и затем добавь строку [***waiting for answer***].\n"
  );
}

function parseShellCommands(text) {
  const out = [];
  const re = /<<<SHELL_COMMAND>>>([\s\S]*?)<<<\/SHELL_COMMAND>>>/g;
  const s = String(text || "");
  let m;
  while ((m = re.exec(s))) {
    const cmd = (m[1] || "").trim();
    if (cmd) out.push(cmd);
  }
  return out;
}

function stripPreamble(s) {
  let out = String(s || "").trim();
  const cutMarkers = [
    /(^|\n)\s*[-–—]{3,}\s*(\n|$)/,
    /\n##\s+Промпт\s+для\s+Cursor\s+Agent\s+CLI\b/i,
    /\n#\s+Промпт\b/i,
  ];
  for (const re of cutMarkers) {
    const m = out.match(re);
    if (m && typeof m.index === "number" && m.index > 0 && m.index < 2000) {
      out = out.slice(m.index).trim();
      break;
    }
  }
  out = out.replace(/^[-–—]{3,}\s*\n+/g, "");
  out = out.replace(/^#{1,3}\s*Промпт[^\n]*\n+/gi, "");
  out = out.replace(/^\*\*(Ticket|Project)\*\*:[^\n]*\n+/gim, "");
  return out.trim();
}

function promptForStep(stepIndex, ctx, planOrIntro, subtaskText, doneSummary) {
  if (stepIndex === 1) {
    return [
      "Ты агент Cursor CLI в рабочей копии репозитория (workspace).",
      "",
      ctx,
      "",
      "Шаг 1: Анализ и выбор первых 3 подзадач лёгкой/средней сложности.",
      "Выведи блоки:",
      "<<<CHAT_INTRO>>> ... <<</CHAT_INTRO>>>",
      "<<<SUBTASKS>>> 1) ... 2) ... 3) ... <<</SUBTASKS>>>",
      "После этого можно кратко указать риски и что отложено.",
      ruBlock(),
    ].join("\n");
  }
  if (stepIndex >= 2 && stepIndex <= 4) {
    const n = stepIndex - 1;
    return [
      "Та же задача и тот же workspace.",
      "",
      "Контекст тикета:",
      ctx,
      "",
      planOrIntro ? `Контекст/анализ:\n${planOrIntro}\n` : "",
      doneSummary ? `Уже сделано:\n${doneSummary}\n` : "",
      `Шаг ${stepIndex}: Выполни подзадачу #${n}.`,
      subtaskText || "(подзадача не распознана; попроси уточнить)",
      "",
      "В конце: что сделано и что осталось.",
      ruBlock(),
    ].join("\n");
  }
  return [
    "Та же задача и workspace.",
    "",
    "Контекст тикета:",
    ctx,
    "",
    doneSummary ? `Сводка сделанного:\n${doneSummary}\n` : "",
    "Шаг 5: Итог, проверки, следующие 3 подзадачи (если нужно).",
    ruBlock(),
  ].join("\n");
}

function parseSubtasks(text) {
  const subM = String(text || "").match(/<<<SUBTASKS>>>([\s\S]*?)<<<\/SUBTASKS>>>/);
  const list = [];
  if (subM) {
    for (const line of subM[1].split("\n")) {
      const m = line.trim().match(/^(\d+)[\.\)]\s+(.+)$/);
      if (m) list.push(m[2].trim());
    }
  }
  return list.slice(0, 3);
}

function parseIntro(text) {
  const m = String(text || "").match(/<<<CHAT_INTRO>>>([\s\S]*?)<<<\/CHAT_INTRO>>>/);
  return m ? m[1].trim() : "";
}

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("Usage: agent-runner.mjs <runId>");

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: { steps: { orderBy: { index: "asc" } }, project: true },
  });
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.project?.workspacePath) throw new Error("Project workspacePath missing");

  if (run.status !== "queued") return;

  await prisma.agentRun.update({ where: { id: runId }, data: { status: "running", startedAt: now() } });
  await emit(runId, "ack", "Задание принято в очередь");
  await emit(runId, "started", "Запуск обработки");

  const ctx = run.prompt || "";
  const phaseTimeoutMs = Number(process.env.AGENT_ORCHESTRATOR_PHASE_TIMEOUT_MS || "600000") || 600000;

  if (run.kind === "engineering_prompt") {
    const step = run.steps?.[0];
    if (!step) throw new Error("engineering_prompt run has no step");

    await setStep(runId, step.index, { status: "running", startedAt: now() });
    await emit(runId, "step_started", step.title, { stepIndex: step.index, title: step.title });
    await prisma.agentRun.update({ where: { id: runId }, data: { promptHash: hashPrompt(ctx) } });

    let stopped = false;
    const hb = setInterval(() => {
      if (stopped) return;
      void emit(runId, "heartbeat", "Генерирую инженерный промпт…", { stepIndex: step.index });
    }, 15000);

    const r = await runAgentPrompt(run.project.workspacePath, ctx + ruBlock(), phaseTimeoutMs, EXECUTOR_MODEL_ID);
    stopped = true;
    clearInterval(hb);

    const raw = (r.ok ? r.stdout : r.stderr || r.stdout).trim() || "(пустой ответ agent)";
    const cleaned = stripPreamble(raw);

    if (!r.ok) {
      await setStep(runId, step.index, { status: "failed", finishedAt: now() });
      await prisma.agentRun.update({ where: { id: runId }, data: { status: "failed", finishedAt: now() } });
      await emit(runId, "failed", "Генерация промпта завершилась ошибкой/таймаутом", { ok: false, length: raw.length });
      if (run.sessionId) {
        await prisma.chatMessage.create({
          data: { sessionId: run.sessionId, role: "assistant", content: `### Инженерный промпт (ошибка)\n\n${raw}` },
        });
        await prisma.chatSession.update({ where: { id: run.sessionId }, data: { updatedAt: now() } });
      }
      return;
    }

    if (run.backlogItemId) {
      await prisma.backlogItem.update({
        where: { id: run.backlogItemId },
        data: { descriptionPrompt: cleaned, promptModel: "cursor-agent", promptCreatedAt: now() },
      });
    }

    await emit(runId, "engineering_prompt_ready", "Инженерный промпт готов", { length: cleaned.length });

    if (run.sessionId) {
      await prisma.chatMessage.create({
        data: { sessionId: run.sessionId, role: "assistant", content: `### Инженерный промпт готов\n\nПромпт записан в поле «Промпт / ТЗ для агента».` },
      });
      await prisma.chatSession.update({ where: { id: run.sessionId }, data: { updatedAt: now() } });
    }

    await setStep(runId, step.index, { status: "done", finishedAt: now() });
    await prisma.agentRun.update({ where: { id: runId }, data: { status: "done", finishedAt: now() } });
    await emit(runId, "done", "Готово");
    return;
  }

  let analysisText = "";
  let subtasks = [];
  let doneSummary = "";

  for (const step of run.steps) {
    if (step.status !== "pending") continue;

    await setStep(runId, step.index, { status: "running", startedAt: now() });
    await emit(runId, "step_started", step.title, { stepIndex: step.index, title: step.title });

    const stepPrompt = promptForStep(step.index, ctx, analysisText, subtasks[step.index - 2], doneSummary);
    await prisma.agentRun.update({ where: { id: runId }, data: { promptHash: hashPrompt(stepPrompt) } });

    // heartbeat event loop while agent is running
    let stopped = false;
    const hb = setInterval(() => {
      if (stopped) return;
      void emit(runId, "heartbeat", `Шаг ${step.index}/5 выполняется…`, {
        stepIndex: step.index,
        last: new Date().toISOString(),
      });
    }, 15000);

    const r = await runAgentPrompt(run.project.workspacePath, stepPrompt, phaseTimeoutMs, EXECUTOR_MODEL_ID);
    stopped = true;
    clearInterval(hb);

    const out = (r.ok ? r.stdout : r.stderr || r.stdout).trim() || "(пустой ответ agent)";
    await emit(runId, r.ok ? "step_output" : "step_error", `Шаг ${step.index}/5: вывод`, {
      stepIndex: step.index,
      ok: r.ok,
      length: out.length,
    });

    // also append to chat (if linked)
    if (run.sessionId) {
      await prisma.chatMessage.create({
        data: {
          sessionId: run.sessionId,
          role: "assistant",
          content: `### ${step.title}\n\n${out}`,
        },
      });
      await prisma.chatSession.update({ where: { id: run.sessionId }, data: { updatedAt: now() } });
    }

    if (!r.ok) {
      await setStep(runId, step.index, { status: "failed", finishedAt: now() });
      await prisma.agentRun.update({ where: { id: runId }, data: { status: "failed", finishedAt: now() } });
      await emit(runId, "failed", "Шаг завершился ошибкой/таймаутом", { stepIndex: step.index });
      return;
    }

    // step ok
    await setStep(runId, step.index, { status: "done", finishedAt: now() });
    await emit(runId, "step_done", "Шаг выполнен", { stepIndex: step.index });

    const cmds = parseShellCommands(out);
    if (cmds.length) {
      await emit(runId, "cmd_proposed", "Агент предлагает выполнить команду (требует подтверждения)", {
        stepIndex: step.index,
        commands: cmds,
      });
      await prisma.agentRun.update({ where: { id: runId }, data: { status: "waiting_user" } });
      await emit(runId, "waiting_user", "Ожидаю подтверждения команды в UI", { stepIndex: step.index });
      return;
    }

    if (looksLikeWaiting(out)) {
      await prisma.agentRun.update({ where: { id: runId }, data: { status: "waiting_user" } });
      await emit(runId, "waiting_user", "Агент ждёт ответа пользователя", { stepIndex: step.index });
      return;
    }

    if (step.index === 1) {
      analysisText = out;
      subtasks = parseSubtasks(out);
      const intro = parseIntro(out);
      if (run.sessionId && intro) {
        await prisma.chatMessage.create({
          data: { sessionId: run.sessionId, role: "assistant", content: `### Сообщение для пользователя\n\n${intro}` },
        });
        await prisma.chatSession.update({ where: { id: run.sessionId }, data: { updatedAt: now() } });
      }
    } else if (step.index >= 2 && step.index <= 4) {
      doneSummary += `\n\n---\n\n${out}`;
    } else if (step.index === 5) {
      // done
    }
  }

  await prisma.agentRun.update({ where: { id: runId }, data: { status: "done", finishedAt: now() } });
  await emit(runId, "done", "Готово");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    try {
      const runId = process.argv[2];
      if (runId) {
        await emit(runId, "failed", e instanceof Error ? e.message : String(e));
        await prisma.agentRun.update({ where: { id: runId }, data: { status: "failed", finishedAt: now() } });
      }
    } catch {
      // ignore
    } finally {
      await prisma.$disconnect();
    }
    process.exit(1);
  });


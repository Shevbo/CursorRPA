/**
 * Адаптивный оркестратор: 1) анализ + 3 приоритетные «лёгкие/средние» подзадачи в разметке;
 * 2–4) выполнение каждой; 5) итог и следующие шаги.
 * argv: <sessionId> <workspacePath> <ticketContextB64> <phaseTimeoutMs>
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runAgentPrompt } from "./lib/agent-cli.mjs";
import { shectoryWikiPreamble } from "./lib/shectory-wiki.mjs";

const prisma = new PrismaClient();

const EXECUTOR_MODEL_ID = (process.env.SHECTORY_EXECUTOR_AGENT_MODEL_ID || "gemini-3.1-pro").trim();

const TOTAL_STEPS = 5;
const WAITING_CODE = "[***waiting for answer***]";

const RU_BLOCK = `\n\n━━ ЯЗЫК И ФОРМАТ ━━\n- Весь связный текст в ответе — ТОЛЬКО на **русском** (имена файлов, команды терминала, идентификаторы API и фрагменты кода можно оставить как в проекте).\n- Не используй английские вводные («Sure», «Here is», «Let me», «I'll» и т.п.).\n- Не пиши целые абзацы на английском.\n- Если тебе нужно получить ответ/уточнение от человека (вопрос, выбор вариантов, согласование), в КОНЦЕ ответа добавь ровно одну строку: [***waiting for answer***]\n- После строки [***waiting for answer***] не продолжай реализацию; остановись и жди ответ пользователя.`;

function trimMax() {
  const n = parseInt(process.env.AGENT_ORCHESTRATOR_CONTEXT_TRIM || "12000", 10);
  return Number.isFinite(n) && n >= 2000 ? n : 12000;
}

function trimCtx(s, max) {
  const lim = max ?? trimMax();
  const t = String(s ?? "").trim();
  if (t.length <= lim) return t;
  return "[…начало сокращено…]\n" + t.slice(-lim);
}

function pidFile(sessionId) {
  return path.join(process.cwd(), "tmp", "agent-runs", `${sessionId}.pid`);
}

function clearPidFile(sessionId) {
  try {
    fs.unlinkSync(pidFile(sessionId));
  } catch {
    // ignore
  }
}

function formatRun({ ok, stdout, stderr }) {
  const text = (ok ? stdout : stderr || stdout).trim();
  return text || "(пустой ответ agent)";
}

async function postAssistant(sessionId, title, body) {
  const content = `### ${title}\n\n${body}`;
  await prisma.chatMessage.create({ data: { sessionId, role: "assistant", content } });
  await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
}

function stepFromHeartbeatLabel(label) {
  // label examples: "Шаг 1: анализ" | "Шаг 3: подзадача 2/3" | "Шаг 5: итог"
  const m = String(label).match(/Шаг\s+(\d+)\s*:/im);
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * @param {string} sessionId
 * @param {string} label
 * @param {string} workspacePath
 * @param {string} prompt
 * @param {number} timeoutMs
 */
async function runWithHeartbeats(sessionId, label, workspacePath, prompt, timeoutMs) {
  const sec = parseInt(process.env.AGENT_ORCHESTRATOR_HEARTBEAT_SEC || "45", 10);
  const tickMs = (Number.isFinite(sec) && sec >= 15 ? sec : 45) * 1000;
  const t0 = Date.now();
  const interval = setInterval(() => {
    void (async () => {
      try {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        const step = stepFromHeartbeatLabel(label);
        const stepTitle = step ? `Шаг ${step}/${TOTAL_STEPS}` : "Шаг ?/?";
        await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "assistant",
            content:
              `### ${stepTitle} — выполняется\n\n` +
              `⏳ ${label} — CLI агента всё ещё выполняется (~${elapsed} с с начала этого шага). Сообщение автоматическое.`,
          },
        });
        await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
      } catch {
        // ignore
      }
    })();
  }, tickMs);

  try {
    return await runAgentPrompt(workspacePath, shectoryWikiPreamble() + prompt + RU_BLOCK, timeoutMs, EXECUTOR_MODEL_ID);
  } finally {
    clearInterval(interval);
  }
}

function parseAnalysis(text) {
  const introM = text.match(/<<<CHAT_INTRO>>>([\s\S]*?)<<<\/CHAT_INTRO>>>/);
  const subM = text.match(/<<<SUBTASKS>>>([\s\S]*?)<<<\/SUBTASKS>>>/);
  let intro = introM ? introM[1].trim() : "";
  /** @type {string[]} */
  let subtasks = [];
  if (subM) {
    for (const line of subM[1].split("\n")) {
      const t = line.trim();
      const m = t.match(/^(\d+)[\.\)]\s+(.+)$/);
      if (m) subtasks.push(m[2].trim());
    }
  }
  if (subtasks.length < 3) {
    subtasks = [];
    for (const line of text.split("\n")) {
      const m = line.trim().match(/^(\d+)[\.\)]\s+(.+)/);
      if (m) subtasks.push(m[2].trim());
    }
    subtasks = subtasks.filter((s, i, a) => a.indexOf(s) === i).slice(0, 3);
  }
  return { intro, subtasks: subtasks.slice(0, 3), raw: text.trim() };
}

function analysisPrompt(ctx) {
  return [
    "Ты агент Cursor CLI в рабочей копии репозитория (workspace).",
    "",
    trimCtx(ctx, trimMax()),
    "",
    "── Задача этого шага: только анализ (правки кода не делай; чтение файлов допустимо) ──",
    "Тикет часто **нельзя** честно разбить на заранее известное число точных этапов. Твоя задача:",
    "1) Оценить объём и риски.",
    "2) Выбрать **ровно три** первых по приоритету подзадачи, которые по твоей оценке имеют сложность **лёгкая или средняя** (не больше).",
    "3) Сформулировать для человека короткое вводное сообщение: что точные этапы на весь тикет заранее не фиксируешь; какие **три задачи** берёшь сейчас; что после их выполнения вернёшься с **следующими тремя** (или с уточнённым планом) и будешь писать об этом здесь в чате.",
    "",
    "Обязательно выведи два блока **точно в таком виде** (маркеры как есть, латиница):",
    "",
    "<<<CHAT_INTRO>>>",
    "(сюда 3–6 предложений на русском для ленты чата — это увидит человек)",
    "<<</CHAT_INTRO>>>",
    "",
    "<<<SUBTASKS>>>",
    "1) первая подзадача одной строкой",
    "2) вторая подзадача одной строкой",
    "3) третья подзадача одной строкой",
    "<<</SUBTASKS>>>",
    "",
    "После блоков можешь кратко (по-русски) пояснить риски и что отложено на потом.",
  ].join("\n");
}

function subtaskPrompt(ctx, index1based, total, subtask, priorSummary) {
  return [
    "Та же задача и тот же workspace.",
    "",
    "Контекст тикета:",
    trimCtx(ctx, trimMax()),
    "",
    priorSummary ? `Сделано ранее в этой сессии (сжато):\n${trimCtx(priorSummary, Math.floor(trimMax() * 0.5))}\n` : "",
    `── Подзадача ${index1based}/${total} (выполни её в коде) ──`,
    subtask,
    "",
    "- Внеси нужные изменения в репозиторий.",
    "- В конце кратко на русском: что сделано в рамках этой подзадачи и что осталось.",
  ].join("\n");
}

function finalPrompt(ctx, subtasks, workBlock) {
  return [
    "Та же задача и workspace.",
    "",
    "Контекст тикета:",
    trimCtx(ctx, Math.floor(trimMax() * 0.4)),
    "",
    "Три подзадачи этого захода:",
    subtasks.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    "Сводка выполненной работы:",
    trimCtx(workBlock, Math.floor(trimMax() * 0.55)),
    "",
    "── Итоговый шаг ──",
    "- Проверь результат (при необходимости тесты/линтер).",
    "- Резюме на русском: выполнено, не сделано, открытые вопросы.",
    "- Предложи **следующие три** подзадачи для следующего захода (или напиши, что тикет можно закрыть / нужен другой формат работы).",
  ].join("\n");
}

async function main() {
  let sessionId = "";
  try {
    const argv = process.argv.slice(2);
    sessionId = argv[0] || "";
    const workspacePath = argv[1];
    const contextB64 = argv[2];
    const timeoutStr = argv[3];
    if (!sessionId || !workspacePath || !contextB64) {
      throw new Error(
        "Usage: ticket-orchestrator-runner.mjs <sessionId> <workspacePath> <ticketContextB64> <phaseTimeoutMs>"
      );
    }
    const phaseTimeoutMs =
      Number(timeoutStr || process.env.AGENT_ORCHESTRATOR_PHASE_TIMEOUT_MS || "") ||
      Number(process.env.AGENT_PROMPT_TIMEOUT_MS || "1800000") ||
      1_800_000;
    const ctx = Buffer.from(contextB64, "base64").toString("utf8");

    const onStop = () => clearPidFile(sessionId);
    process.on("SIGTERM", onStop);
    process.on("SIGINT", onStop);

    await postAssistant(
      sessionId,
      "Оркестратор",
      `Запускаю **адаптивный сценарий** (${TOTAL_STEPS} шагов): анализ и выбор 3 подзадач → выполнение каждой → итог. Таймаут одного вызова CLI ~${Math.round(phaseTimeoutMs / 60000)} мин. Пока CLI молчит, будут приходить **автоматические ⏳-сообщения** каждые ~${process.env.AGENT_ORCHESTRATOR_HEARTBEAT_SEC || "45"} с.`
    );

    const rA = await runWithHeartbeats(
      sessionId,
      "Шаг 1: анализ",
      workspacePath,
      analysisPrompt(ctx),
      phaseTimeoutMs
    );
    const rawA = formatRun(rA);
    const waitingAfterAnalysis = rawA.includes(WAITING_CODE);
    const parsed = parseAnalysis(rawA);

    let introForChat = parsed.intro;
    let subs = parsed.subtasks;
    if (!introForChat) {
      introForChat =
        "Не удалось разобрать блок CHAT_INTRO. Ниже сырой ответ анализа; подзадачи выведены эвристически или заданы запасным планом.";
    }
    if (subs.length < 3) {
      subs = [
        "Уточнить и реализовать минимально жизнеспособную часть тикета по описанию",
        "Проверить согласованность с остальным кодом и исправить явные проблемы",
        "Кратко задокументировать сделанное и риски",
      ];
      await postAssistant(
        sessionId,
        "Шаг 1/5 — предупреждение",
        "Модель не вернула три подзадачи в блоке SUBTASKS. Использую **запасной набор из трёх шагов**; при необходимости перезапустите сценарий."
      );
    }

    await postAssistant(sessionId, "Шаг 1/5 — сообщение для чата", introForChat);
    await postAssistant(
      sessionId,
      "Шаг 1/5 — анализ (сырой ответ)",
      trimCtx(rawA, trimMax()) + (rA.ok ? "" : "\n\n_(анализ завершился с ошибкой CLI; следующие шаги пропущены)_")
    );
    if (!rA.ok) return;
    if (waitingAfterAnalysis) return;

    /** @type {string[]} */
    const doneParts = [];
    for (let i = 0; i < 3; i++) {
      const label = `Шаг ${i + 2}: подзадача ${i + 1}/3`;
      const rp = await runWithHeartbeats(
        sessionId,
        label,
        workspacePath,
        subtaskPrompt(ctx, i + 1, 3, subs[i], doneParts.join("\n\n---\n\n")),
        phaseTimeoutMs
      );
      const out = formatRun(rp);
      const waitingNow = out.includes(WAITING_CODE);
      await postAssistant(
        sessionId,
        `Шаг ${i + 2}/5 — подзадача ${i + 1}/3`,
        `**${subs[i]}**\n\n${out}` + (rp.ok ? "" : "\n\n_(ошибка CLI; следующие подзадачи пропущены)_")
      );
      if (!rp.ok) return;
      doneParts.push(out);
      if (waitingNow) return;
    }

    const rF = await runWithHeartbeats(
      sessionId,
      "Шаг 5: итог",
      workspacePath,
      finalPrompt(ctx, subs, doneParts.join("\n\n---\n\n")),
      phaseTimeoutMs
    );
    const outF = formatRun(rF);
    const waitingFinal = outF.includes(WAITING_CODE);
    await postAssistant(sessionId, "Шаг 5/5 — итог и дальнейшие шаги", outF);
    if (waitingFinal) return;
  } catch (e) {
    if (sessionId) {
      try {
        await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "assistant",
            content: `Ошибка оркестратора: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      } catch {
        // ignore
      }
    }
    throw e;
  } finally {
    if (sessionId) clearPidFile(sessionId);
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch(() => process.exit(1));

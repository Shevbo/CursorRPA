/**
 * Утилиты для автоматического обновления чеклиста тикета из агентских скриптов.
 *
 * Агент сигнализирует о завершении шага маркером в конце ответа:
 *   [STEP_DONE: текст шага]
 *
 * Логика сопоставления: нечёткий поиск — ищем пункт чеклиста, текст которого
 * содержится в метке или метка содержится в тексте (case-insensitive, первые 60 символов).
 */

/**
 * Извлечь все метки [STEP_DONE: ...] из текста ответа агента.
 * @param {string} replyText
 * @returns {string[]}
 */
export function extractStepDoneLabels(replyText) {
  const text = String(replyText || "");
  const re = /\[STEP_DONE:\s*([^\]]+)\]/gi;
  const labels = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const label = m[1]?.trim();
    if (label) labels.push(label);
  }
  return labels;
}

/**
 * Найти пункты чеклиста, соответствующие меткам из ответа агента.
 * Сопоставление нечёткое: первые 60 символов текста/метки, case-insensitive.
 *
 * @param {Array<{id: string, text: string, done: boolean}>} checkItems
 * @param {string[]} labels
 * @returns {string[]} ids пунктов для отметки
 */
/** Мин. длина метки [STEP_DONE: …] — короткие строки давали ложные совпадения сразу с несколькими пунктами. */
const MIN_STEP_LABEL_LEN = 12;
/** Мин. длина фрагмента для проверки «входит как подстрока» (иначе «1.», «ok» и т.п. цепляли всё подряд). */
const MIN_OVERLAP_CHUNK = 22;

/**
 * @param {Array<{id: string, text: string, done: boolean}>} checkItems
 * @param {string[]} labels
 * @returns {string[]}
 */
export function matchCheckItemsByLabels(checkItems, labels) {
  const ids = new Set();
  for (const label of labels) {
    const raw = String(label ?? "").trim();
    if (raw.length < MIN_STEP_LABEL_LEN) continue;

    const lNorm = raw.toLowerCase();
    const lChunk = lNorm.slice(0, Math.min(80, lNorm.length));
    if (lChunk.length < MIN_OVERLAP_CHUNK) continue;

    let bestId = null;
    let bestScore = 0;
    for (const item of checkItems) {
      if (item.done) continue;
      const iNorm = item.text.toLowerCase();
      const iHead = iNorm.slice(0, Math.min(80, iNorm.length));
      if (iHead.length < MIN_OVERLAP_CHUNK) continue;

      let ok = false;
      if (iNorm.includes(lChunk) || lNorm.includes(iHead.slice(0, MIN_OVERLAP_CHUNK))) ok = true;
      const l80 = lNorm.slice(0, 80);
      const i80 = iNorm.slice(0, 80);
      if (l80.length >= MIN_STEP_LABEL_LEN && (i80.startsWith(l80) || l80.startsWith(i80.slice(0, Math.min(i80.length, l80.length))))) {
        ok = true;
      }
      if (!ok) continue;

      const score = Math.min(lNorm.length, iNorm.length);
      if (score > bestScore) {
        bestScore = score;
        bestId = item.id;
      }
    }
    if (bestId) ids.add(bestId);
  }
  return Array.from(ids);
}

/**
 * Отметить пункты чеклиста как выполненные (предварительно — до аудитора).
 * Возвращает количество обновлённых пунктов.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} backlogItemId
 * @param {string[]} ids
 * @param {boolean} [confirmed=false] — true если подтверждено аудитором
 * @returns {Promise<number>}
 */
export async function markCheckItemsDone(prisma, backlogItemId, ids, confirmed = false) {
  if (!ids.length) return 0;
  // Verify items belong to this backlogItem
  const items = await prisma.backlogCheckItem.findMany({
    where: { id: { in: ids }, backlogItemId },
    select: { id: true },
  });
  const validIds = items.map((i) => i.id);
  if (!validIds.length) return 0;
  await prisma.backlogCheckItem.updateMany({
    where: { id: { in: validIds } },
    data: { done: true, doneAt: new Date() },
  });
  return validIds.length;
}

/**
 * Полный цикл: извлечь метки из ответа, найти пункты, отметить выполненными.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} sessionId
 * @param {string} replyText
 * @returns {Promise<{labels: string[], matched: number}>}
 */
export async function applyStepDoneFromReply(prisma, sessionId, replyText) {
  const labels = extractStepDoneLabels(replyText);
  if (!labels.length) return { labels: [], matched: 0 };

  // Get backlogItemId from session
  const sess = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { backlogItemId: true },
  });
  const backlogItemId = sess?.backlogItemId;
  if (!backlogItemId) return { labels, matched: 0 };

  // Get current checklist
  const checkItems = await prisma.backlogCheckItem.findMany({
    where: { backlogItemId, done: false },
    select: { id: true, text: true, done: true },
  });
  if (!checkItems.length) return { labels, matched: 0 };

  const ids = matchCheckItemsByLabels(checkItems, labels);
  const matched = await markCheckItemsDone(prisma, backlogItemId, ids);
  return { labels, matched };
}

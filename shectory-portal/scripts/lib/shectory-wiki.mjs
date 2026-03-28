import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Абсолютный путь к Shectory Wikipedia (корень репозитория /docs).
 */
export function resolveShectoryWikiPath() {
  const fromScript = join(__dirname, "..", "..", "..", "docs", "shectory-wikipedia.md");
  if (fs.existsSync(fromScript)) return fromScript;
  const fromCwd = join(process.cwd(), "docs", "shectory-wikipedia.md");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return fromScript;
}

export function getShectoryWikiText() {
  try {
    const p = resolveShectoryWikiPath();
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/**
 * Вставка в промпт CLI-агента: стандарты Shectory + полный текст Wikipedia.
 */
export function shectoryWikiPreamble() {
  const t = getShectoryWikiText().trim();
  if (!t) {
    return (
      "\n\n━━ Shectory Wikipedia ━━\n" +
      "(файл docs/shectory-wikipedia.md не найден на сервере — следуй общим практикам репозитория и запросам пользователя.)\n\n"
    );
  }
  return (
    "\n\n━━ Shectory Wikipedia (прочитай; при фразе пользователя «читай википедию shectory» — перечитай и действуй по нему) ━━\n" +
    t +
    "\n\n━━ Конец Shectory Wikipedia ━━\n\n"
  );
}

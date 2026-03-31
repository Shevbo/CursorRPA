export type ChatAttachmentMeta = { name: string; relPath: string };

export const CHAT_ATTACHMENTS_DIR = ".shectory-chat-attachments";

const ALLOWED_EXT = new Set(
  [
    "txt",
    "md",
    "markdown",
    "json",
    "csv",
    "log",
    "py",
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "java",
    "go",
    "rs",
    "rb",
    "php",
    "sql",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "properties",
    "ps1",
    "sh",
    "bash",
    "zsh",
    "dockerfile",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "pdf",
    "doc",
    "docx",
    "rst",
    "adoc",
  ].map((s) => s.toLowerCase())
);

const BLOCKED_EXT = new Set(
  ["exe", "dll", "so", "dylib", "bin", "msi", "deb", "rpm", "apk", "scr", "bat", "cmd", "com", "msi"].map((s) =>
    s.toLowerCase()
  )
);

export const CHAT_ATTACHMENT_MAX_FILES = 15;
export const CHAT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024; // per file
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export function parseChatAttachmentsJson(raw: string | null | undefined): ChatAttachmentMeta[] {
  try {
    const j = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        name: String((x as ChatAttachmentMeta).name || "file"),
        relPath: String((x as ChatAttachmentMeta).relPath || "").replace(/\\/g, "/"),
      }))
      .filter((x) => x.relPath && !x.relPath.includes(".."));
  } catch {
    return [];
  }
}

export function safeAttachmentBasename(original: string): string {
  const base = (original.replace(/\\/g, "/").split("/").pop() || "file").replace(/[\x00-\x1f]/g, "_");
  if (!base || base === "." || base === "..") return "file";
  return base.slice(0, 200);
}

export function attachmentExtensionOk(basename: string): { ok: boolean; reason?: string } {
  const i = basename.lastIndexOf(".");
  const ext = i >= 0 ? basename.slice(i + 1).toLowerCase() : "";
  if (!ext) return { ok: false, reason: "Нужно расширение файла" };
  if (BLOCKED_EXT.has(ext)) return { ok: false, reason: `Тип .${ext} не допускается` };
  if (!ALLOWED_EXT.has(ext)) return { ok: false, reason: `Расширение .${ext} не в списке разрешённых` };
  return { ok: true };
}

export function formatAttachmentsBlockForAgent(items: ChatAttachmentMeta[]): string {
  if (!items.length) return "";
  const lines = items.map((x) => `- ${x.relPath} (имя: ${x.name})`).join("\n");
  return (
    `\n\n━━ Вложения пользователя (прочитай файлы по путям относительно корня workspace; это копии во вложении, не правь оригиналы в других каталогах без отдельного запроса) ━━\n` +
    `${lines}`
  );
}

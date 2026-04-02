import type { ClipboardEvent } from "react";
import { CHAT_ATTACHMENT_MAX_FILES } from "@/lib/chat-attachments";

/** Собрать файлы из ClipboardEvent (скриншот, копирование файла в буфер). */
export function collectClipboardFiles(e: ClipboardEvent): File[] {
  const dt = e.clipboardData;
  if (!dt) return [];

  // Prefer dt.files (real File objects from OS) over dt.items.getAsFile()
  // which can produce duplicates with different lastModified timestamps.
  // Deduplicate by name+size (lastModified is unstable across sources).
  const byKey = new Map<string, File>();
  const add = (f: File | null) => {
    if (!f || !f.size) return;
    // Use name+size as key — lastModified is unreliable (0 vs Date.now())
    const k = `${f.name}:${f.size}`;
    if (!byKey.has(k)) byKey.set(k, f);
  };

  // dt.files is the authoritative source when available
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) add(dt.files.item(i));
    // If dt.files already gave us files, don't also iterate dt.items
    // to avoid duplicates (same file appears in both on most browsers)
    return Array.from(byKey.values());
  }

  // Fallback: iterate items (e.g. screenshot paste where dt.files is empty)
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind === "file") add(item.getAsFile());
  }
  return Array.from(byKey.values());
}

export function mergePendingFiles(prev: File[], incoming: File[]): File[] {
  if (incoming.length === 0) return prev;
  // Deduplicate against already-pending files by name+size
  const existingKeys = new Set(prev.map((f) => `${f.name}:${f.size}`));
  const newOnly = incoming.filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
  return [...prev, ...newOnly].slice(0, CHAT_ATTACHMENT_MAX_FILES);
}

/** Human-readable file size: "12 KB", "1.4 MB", etc. */
export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

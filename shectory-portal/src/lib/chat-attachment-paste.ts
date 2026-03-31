import type { ClipboardEvent } from "react";
import { CHAT_ATTACHMENT_MAX_FILES } from "@/lib/chat-attachments";

/** Собрать файлы из ClipboardEvent (скриншот, копирование файла в буфер). */
export function collectClipboardFiles(e: ClipboardEvent): File[] {
  const dt = e.clipboardData;
  if (!dt) return [];
  const byKey = new Map<string, File>();
  const add = (f: File | null) => {
    if (!f || !f.size) return;
    const k = `${f.name}:${f.size}:${f.lastModified}`;
    if (!byKey.has(k)) byKey.set(k, f);
  };
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) add(dt.files.item(i));
  }
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind === "file") add(item.getAsFile());
  }
  return Array.from(byKey.values());
}

export function mergePendingFiles(prev: File[], incoming: File[]): File[] {
  if (incoming.length === 0) return prev;
  return [...prev, ...incoming].slice(0, CHAT_ATTACHMENT_MAX_FILES);
}

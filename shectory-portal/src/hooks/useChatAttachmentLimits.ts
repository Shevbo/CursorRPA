"use client";

import { useEffect, useState } from "react";

export function useChatAttachmentLimits() {
  const [maxFiles, setMaxFiles] = useState(15);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/system/limits", { credentials: "include" })
      .then((r) => r.json())
      .then((j: { chatAttachmentMaxFiles?: number }) => {
        if (cancelled) return;
        const n = j?.chatAttachmentMaxFiles;
        if (typeof n === "number" && n >= 1) setMaxFiles(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return { maxFiles };
}

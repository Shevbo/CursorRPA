"use client";

import { useEffect, useId, useRef } from "react";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });

export function MermaidBlock({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { svg } = await mermaid.render(`mm-${uid}`, chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled && ref.current)
          ref.current.textContent = "Mermaid: " + (e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [chart, uid]);

  return <div ref={ref} className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/50 p-4" />;
}

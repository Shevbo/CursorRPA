import type { ReactNode } from "react";

export default function TicketChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-200">{children}</div>
  );
}

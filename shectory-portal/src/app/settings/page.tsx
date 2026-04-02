import { PortalSettingsClient } from "@/components/PortalSettingsClient";
import { HealthDiagnosticDock } from "@/components/HealthDiagnosticDock";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="relative min-h-screen">
      <main className="min-h-screen min-w-0 overflow-x-hidden bg-slate-950 pb-[18rem] text-slate-200 sm:pb-[9.5rem]">
        <PortalSettingsClient />
      </main>
      <HealthDiagnosticDock />
    </div>
  );
}

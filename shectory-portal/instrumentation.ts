export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadRuntimeEnvIntoProcess } = await import("@/lib/portal-runtime-env");
  loadRuntimeEnvIntoProcess();
  try {
    const { ensurePortalSettingsSeeded, syncRuntimeEnvFileAndProcess } = await import("@/lib/portal-settings");
    await ensurePortalSettingsSeeded();
    await syncRuntimeEnvFileAndProcess();
  } catch {
    /* БД недоступна при старте — подхватится после миграции */
  }
}

import { prisma } from "@/lib/prisma";
import { PORTAL_SETTINGS_REGISTRY } from "@/lib/portal-settings-registry";
import { loadRuntimeEnvIntoProcess, writeRuntimeEnvFile } from "@/lib/portal-runtime-env";

/** Создать отсутствующие строки настроек из реестра. */
export async function ensurePortalSettingsSeeded(): Promise<void> {
  for (const def of PORTAL_SETTINGS_REGISTRY) {
    await prisma.portalSetting.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        value: def.defaultValue,
        isSecret: !!def.isSecret,
        label: def.label,
        description: def.description ?? "",
        groupName: def.group,
      },
      update: {
        label: def.label,
        description: def.description ?? "",
        groupName: def.group,
        isSecret: !!def.isSecret,
      },
    });
  }
}

/** Все пары key→value для файла runtime (включая секреты). */
export async function buildRuntimeEnvMap(): Promise<Record<string, string>> {
  const rows = await prisma.portalSetting.findMany();
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.value !== "") out[r.key] = r.value;
  }
  return out;
}

export async function syncRuntimeEnvFileAndProcess(): Promise<void> {
  const map = await buildRuntimeEnvMap();
  writeRuntimeEnvFile(map);
  loadRuntimeEnvIntoProcess();
}

export type PublicSettingRow = {
  key: string;
  value: string;
  label: string;
  description: string;
  group: string;
  isSecret: boolean;
  secretSet: boolean;
};

/** Для UI: секреты без значения, только флаг заданности. */
export async function listPublicSettings(): Promise<PublicSettingRow[]> {
  await ensurePortalSettingsSeeded();
  const rows = await prisma.portalSetting.findMany({ orderBy: [{ groupName: "asc" }, { key: "asc" }] });
  return rows.map((r) => ({
    key: r.key,
    value: r.isSecret ? "" : r.value,
    label: r.label || r.key,
    description: r.description,
    group: r.groupName,
    isSecret: r.isSecret,
    secretSet: r.isSecret && r.value.length > 0,
  }));
}

export async function updatePortalSettings(
  updates: Record<string, string>,
  opts: { allowSecrets: boolean }
): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    const def = PORTAL_SETTINGS_REGISTRY.find((d) => d.key === key);
    if (!def) continue;
    if (def.isSecret && !opts.allowSecrets) continue;
    await prisma.portalSetting.update({
      where: { key },
      data: { value: value ?? "" },
    });
  }
  await syncRuntimeEnvFileAndProcess();
}

export async function setSecretSetting(key: string, value: string): Promise<void> {
  const def = PORTAL_SETTINGS_REGISTRY.find((d) => d.key === key);
  if (!def?.isSecret) throw new Error("not a secret key");
  await prisma.portalSetting.update({
    where: { key },
    data: { value: value.trim() },
  });
  await syncRuntimeEnvFileAndProcess();
}

/** Ссылки на инструменты проекта из registryMetaJson (без лишних запросов к прикладным API). */
export function prismaStudioUrlFromRegistryMeta(registryMetaJson: unknown): string | null {
  const root = registryMetaJson && typeof registryMetaJson === "object" ? (registryMetaJson as Record<string, unknown>) : {};
  const dev = root.devtools && typeof root.devtools === "object" ? (root.devtools as Record<string, unknown>) : {};
  const u = typeof dev.prismaStudioUrl === "string" ? dev.prismaStudioUrl.trim() : "";
  return u || null;
}

export function buildAdminAssistantPrompt(project: {
  name: string;
  slug: string;
  uiUrl: string | null;
  repoUrl: string | null;
  workspacePath: string;
}): string {
  return [
    `Проект: ${project.name} (${project.slug})`,
    project.uiUrl ? `UI: ${project.uiUrl}` : "UI: -",
    project.repoUrl ? `Repo: ${project.repoUrl}` : "Repo: -",
    `Workspace: ${project.workspacePath}`,
    "",
    "Сформируй команды и ссылки для администрирования проекта (НЕ раскрывая секреты):",
    "- где лежат env/secret-файлы, какие ключи искать (Hoster/VDS)",
    "- как проверить статусы модулей (systemd/docker/psql) на нужных серверах",
    "- как открыть pgAdmin/psql и где смотреть роли/права",
  ].join("\n");
}

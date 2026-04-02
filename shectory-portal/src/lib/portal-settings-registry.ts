/**
 * Реестр настраиваемых параметров портала (ключ = имя переменной окружения для раннеров).
 * Секреты хранятся в БД с isSecret; в UI не отображается значение.
 */

export type PortalSettingDef = {
  key: string;
  label: string;
  description?: string;
  defaultValue: string;
  group: string;
  isSecret?: boolean;
  enumValues?: string[];
};

export const PORTAL_SETTING_GROUPS: Record<string, string> = {
  agents: "Агенты и таймауты",
  ai: "ИИ: исполнитель и аудитор",
  attachments: "Вложения в чат",
  sandbox: "Песочница CLI",
  secrets: "Секреты API",
};

export const PORTAL_SETTINGS_REGISTRY: PortalSettingDef[] = [
  {
    key: "AGENT_PROMPT_TIMEOUT_MS",
    label: "Таймаут одного запроса к агенту (мс)",
    description: "По умолчанию 30 мин. Минимум 60000.",
    defaultValue: "1800000",
    group: "agents",
  },
  {
    key: "AGENT_ORCHESTRATOR_PHASE_TIMEOUT_MS",
    label: "Таймаут фазы оркестратора (мс)",
    description: "Пусто — авто от AGENT_PROMPT_TIMEOUT_MS / 5, в пределах 3–15 мин.",
    defaultValue: "",
    group: "agents",
  },
  {
    key: "AGENT_PROMPT_ARG_MAX",
    label: "Макс. длина промпта в argv до spill в файл",
    description: "См. scripts/lib/agent-cli.mjs",
    defaultValue: "6000",
    group: "agents",
  },
  {
    key: "AUDITOR_MAX_REWORKS",
    label: "Макс. доработок аудитора подряд",
    description: "Чат и exec-аудитор используют это значение.",
    defaultValue: "3",
    group: "agents",
  },
  {
    key: "SHECTORY_EXECUTOR_BACKEND",
    label: "Бэкенд агента-исполнителя",
    description: "cursor_cli — Cursor Agent CLI; gemini_api — Google Generative Language API (нужен GEMINI_API_KEY).",
    defaultValue: "cursor_cli",
    group: "ai",
    enumValues: ["cursor_cli", "gemini_api"],
  },
  {
    key: "SHECTORY_AUDITOR_BACKEND",
    label: "Бэкенд агента-аудитора",
    description: "Пусто = как у исполнителя.",
    defaultValue: "",
    group: "ai",
    enumValues: ["", "cursor_cli", "gemini_api"],
  },
  {
    key: "SHECTORY_EXECUTOR_AGENT_MODEL_ID",
    label: "ID модели исполнителя",
    description: "Для CLI: --model; для Gemini API: имя модели (например gemini-2.0-flash).",
    defaultValue: "gemini-3-flash",
    group: "ai",
  },
  {
    key: "SHECTORY_AUDITOR_AGENT_MODEL_ID",
    label: "ID модели аудитора",
    description: "Аналогично исполнителю.",
    defaultValue: "gemini-3.1-pro",
    group: "ai",
  },
  {
    key: "SHECTORY_EXECUTOR_MODEL_SPEC",
    label: "Подпись исполнителя в UI",
    description: "Текст в скобках у «Агент-исполнитель».",
    defaultValue: "Gemini 3 Flash (gemini-3-flash)",
    group: "ai",
  },
  {
    key: "SHECTORY_AUDITOR_MODEL_SPEC",
    label: "Подпись аудитора в UI",
    description: "Текст в скобках у «Агент-аудитор».",
    defaultValue: "Gemini 3.1 Pro (gemini-3.1-pro)",
    group: "ai",
  },
  {
    key: "CHAT_ATTACHMENT_MAX_FILES",
    label: "Макс. файлов вложений за раз",
    description: "Проверка на сервере; клиент подтягивает лимит через /api/system/limits.",
    defaultValue: "15",
    group: "attachments",
  },
  {
    key: "CHAT_ATTACHMENT_MAX_BYTES",
    label: "Макс. размер одного файла (байт)",
    defaultValue: String(4 * 1024 * 1024),
    group: "attachments",
  },
  {
    key: "CHAT_ATTACHMENT_MAX_TOTAL_BYTES",
    label: "Макс. суммарный размер пакета (байт)",
    defaultValue: String(20 * 1024 * 1024),
    group: "attachments",
  },
  {
    key: "SHECTORY_AGENT_SANDBOX_MODE",
    label: "Режим sandbox Cursor CLI",
    description: "disabled | read-only | см. документацию agent CLI.",
    defaultValue: "disabled",
    group: "sandbox",
  },
  {
    key: "SHECTORY_AGENT_ALLOW_COMMANDS",
    label: "Разрешить команды (--yolo)",
    description: "1 / 0 — передаётся в agent-cli.",
    defaultValue: "1",
    group: "sandbox",
    enumValues: ["0", "1"],
  },
  {
    key: "GEMINI_API_KEY",
    label: "Ключ Google AI (Gemini API)",
    description: "Используется при бэкенде gemini_api. Не показывается после сохранения.",
    defaultValue: "",
    group: "secrets",
    isSecret: true,
  },
];

export const PORTAL_USER_ROLES = ["user", "admin", "superadmin"] as const;
export type PortalUserRole = (typeof PORTAL_USER_ROLES)[number];

export function isPortalUserRole(s: string): s is PortalUserRole {
  return (PORTAL_USER_ROLES as readonly string[]).includes(s);
}

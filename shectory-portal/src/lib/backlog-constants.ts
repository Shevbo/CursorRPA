export const BACKLOG_ITEM_STATUSES = [
  "new",
  "in_progress",
  "testing",
  "done",
  "rejected",
  "archived",
] as const;
export type BacklogItemStatus = (typeof BACKLOG_ITEM_STATUSES)[number];

export const BACKLOG_SPRINT_STATUSES = ["forming", "active", "released", "archived"] as const;
export type BacklogSprintStatus = (typeof BACKLOG_SPRINT_STATUSES)[number];

export function isBacklogItemStatus(s: string): s is BacklogItemStatus {
  return (BACKLOG_ITEM_STATUSES as readonly string[]).includes(s);
}

export function isBacklogSprintStatus(s: string): s is BacklogSprintStatus {
  return (BACKLOG_SPRINT_STATUSES as readonly string[]).includes(s);
}

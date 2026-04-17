-- Shectory Assist: allowlist Telegram user IDs (managed in Shectory Portal).

CREATE TABLE "assist_bot_allowlist_entries" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assist_bot_allowlist_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assist_bot_allowlist_entries_project_id_telegram_user_id_key" ON "assist_bot_allowlist_entries"("project_id", "telegram_user_id");

CREATE INDEX "assist_bot_allowlist_entries_project_id_idx" ON "assist_bot_allowlist_entries"("project_id");

ALTER TABLE "assist_bot_allowlist_entries" ADD CONSTRAINT "assist_bot_allowlist_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

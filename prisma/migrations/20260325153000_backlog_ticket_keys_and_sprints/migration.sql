-- Backlog ticket keys, project prefixes, sprints, and ticket chat binding

-- AlterTable
ALTER TABLE "backlog_items"
  ADD COLUMN IF NOT EXISTS "is_paused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sprint_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ticket_key" TEXT,
  ADD COLUMN IF NOT EXISTS "ticket_seq" INTEGER;

-- AlterTable
ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "backlog_item_id" TEXT;

-- AlterTable
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "ticket_prefix" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_ticket_counters" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "next_seq" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_ticket_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_test_case_counters" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "next_seq" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_test_case_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sprints" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'forming',
  "title" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "project_ticket_counters_project_id_key"
  ON "project_ticket_counters"("project_id");

CREATE UNIQUE INDEX IF NOT EXISTS "project_test_case_counters_project_id_key"
  ON "project_test_case_counters"("project_id");

CREATE INDEX IF NOT EXISTS "sprints_project_id_status_idx"
  ON "sprints"("project_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "sprints_project_id_number_key"
  ON "sprints"("project_id", "number");

CREATE UNIQUE INDEX IF NOT EXISTS "backlog_items_ticket_key_key"
  ON "backlog_items"("ticket_key");

CREATE INDEX IF NOT EXISTS "backlog_items_project_id_ticket_seq_idx"
  ON "backlog_items"("project_id", "ticket_seq");

CREATE INDEX IF NOT EXISTS "chat_sessions_backlog_item_id_idx"
  ON "chat_sessions"("backlog_item_id");

CREATE UNIQUE INDEX IF NOT EXISTS "projects_ticket_prefix_key"
  ON "projects"("ticket_prefix");

-- TestCase keys
ALTER TABLE "test_cases"
  ADD COLUMN IF NOT EXISTS "case_key" TEXT,
  ADD COLUMN IF NOT EXISTS "case_seq" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "test_cases_case_key_key"
  ON "test_cases"("case_key");

CREATE INDEX IF NOT EXISTS "test_cases_project_id_case_seq_idx"
  ON "test_cases"("project_id", "case_seq");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_backlog_item_id_fkey'
  ) THEN
    ALTER TABLE "chat_sessions"
      ADD CONSTRAINT "chat_sessions_backlog_item_id_fkey"
      FOREIGN KEY ("backlog_item_id") REFERENCES "backlog_items"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'backlog_items_sprint_id_fkey'
  ) THEN
    ALTER TABLE "backlog_items"
      ADD CONSTRAINT "backlog_items_sprint_id_fkey"
      FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_ticket_counters_project_id_fkey'
  ) THEN
    ALTER TABLE "project_ticket_counters"
      ADD CONSTRAINT "project_ticket_counters_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_test_case_counters_project_id_fkey'
  ) THEN
    ALTER TABLE "project_test_case_counters"
      ADD CONSTRAINT "project_test_case_counters_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sprints_project_id_fkey'
  ) THEN
    ALTER TABLE "sprints"
      ADD CONSTRAINT "sprints_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;


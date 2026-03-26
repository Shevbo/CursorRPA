-- Agent runs: queue + steps + events (Cursor-like checklist & streaming)

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "backlog_item_id" TEXT,
  "session_id" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "title" TEXT NOT NULL DEFAULT '',
  "prompt" TEXT NOT NULL DEFAULT '',
  "prompt_hash" TEXT,
  "user_message_id" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "last_heartbeat_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_runs_project_id_status_idx" ON "agent_runs"("project_id","status");
CREATE INDEX IF NOT EXISTS "agent_runs_backlog_item_id_created_at_idx" ON "agent_runs"("backlog_item_id","created_at");
CREATE INDEX IF NOT EXISTS "agent_runs_session_id_created_at_idx" ON "agent_runs"("session_id","created_at");

DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_backlog_item_id_fkey"
  FOREIGN KEY ("backlog_item_id") REFERENCES "backlog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS "agent_run_steps" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "agent_run_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_steps_run_id_index_key" ON "agent_run_steps"("run_id","index");
CREATE INDEX IF NOT EXISTS "agent_run_steps_run_id_status_idx" ON "agent_run_steps"("run_id","status");

DO $$ BEGIN
  ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS "agent_run_events" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL DEFAULT '',
  "data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_events_run_id_seq_key" ON "agent_run_events"("run_id","seq");
CREATE INDEX IF NOT EXISTS "agent_run_events_run_id_created_at_idx" ON "agent_run_events"("run_id","created_at");

DO $$ BEGIN
  ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


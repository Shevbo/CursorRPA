-- Add UI URL + flexible registry metadata
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "ui_url" TEXT,
  ADD COLUMN IF NOT EXISTS "registry_meta_json" JSONB;


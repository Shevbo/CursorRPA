-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachments_json" TEXT NOT NULL DEFAULT '[]';

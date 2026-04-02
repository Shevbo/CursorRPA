-- AlterTable: add processing_msg_id to chat_sessions
-- Used as a mutex: non-null means agent is currently processing a message.
ALTER TABLE "chat_sessions" ADD COLUMN "processing_msg_id" TEXT;

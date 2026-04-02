-- CreateTable
CREATE TABLE "portal_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "group_name" TEXT NOT NULL DEFAULT 'general',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_settings_key_key" ON "portal_settings"("key");

-- CreateIndex
CREATE INDEX "portal_settings_group_name_idx" ON "portal_settings"("group_name");

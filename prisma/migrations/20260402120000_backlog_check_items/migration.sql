-- CreateTable
CREATE TABLE "backlog_check_items" (
    "id" TEXT NOT NULL,
    "backlog_item_id" TEXT NOT NULL,
    "order_num" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backlog_check_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backlog_check_items_backlog_item_id_order_num_idx" ON "backlog_check_items"("backlog_item_id", "order_num");

-- AddForeignKey
ALTER TABLE "backlog_check_items" ADD CONSTRAINT "backlog_check_items_backlog_item_id_fkey" FOREIGN KEY ("backlog_item_id") REFERENCES "backlog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

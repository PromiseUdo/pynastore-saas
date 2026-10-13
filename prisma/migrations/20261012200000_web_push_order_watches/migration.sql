-- A guest's browser asking about one order (ROADMAP 18.3).
-- CreateTable
CREATE TABLE "web_push_order_watches" (
    "subscriptionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_push_order_watches_pkey" PRIMARY KEY ("subscriptionId","orderId")
);

-- CreateIndex
CREATE INDEX "web_push_order_watches_orderId_idx" ON "web_push_order_watches"("orderId");

-- CreateIndex
CREATE INDEX "web_push_order_watches_createdAt_idx" ON "web_push_order_watches"("createdAt");

-- AddForeignKey
ALTER TABLE "web_push_order_watches" ADD CONSTRAINT "web_push_order_watches_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "web_push_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_order_watches" ADD CONSTRAINT "web_push_order_watches_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


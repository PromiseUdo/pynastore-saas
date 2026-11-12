-- CreateEnum
CREATE TYPE "WalletRefundStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'ABANDONED');
-- CreateTable
CREATE TABLE "wallet_refunds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "returnId" TEXT,
    "reference" TEXT NOT NULL,
    "status" "WalletRefundStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "performedById" TEXT,
    "gatewayRef" TEXT,
    "lastError" TEXT,
    "orderRefundId" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wallet_refunds_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "wallet_refunds_reference_key" ON "wallet_refunds"("reference");
-- CreateIndex
CREATE UNIQUE INDEX "wallet_refunds_orderRefundId_key" ON "wallet_refunds"("orderRefundId");
-- CreateIndex
CREATE INDEX "wallet_refunds_orderId_status_idx" ON "wallet_refunds"("orderId", "status");
-- CreateIndex
CREATE INDEX "wallet_refunds_status_createdAt_idx" ON "wallet_refunds"("status", "createdAt");
-- AddForeignKey
ALTER TABLE "wallet_refunds" ADD CONSTRAINT "wallet_refunds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "wallet_refunds" ADD CONSTRAINT "wallet_refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

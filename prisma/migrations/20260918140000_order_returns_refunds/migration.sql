-- CreateEnum
CREATE TYPE "OrderReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "OrderPaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelNote" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "returnWindowDays" INTEGER;

-- CreateTable
CREATE TABLE "order_returns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "merchantNote" TEXT,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderLineItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_refunds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "returnId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_returns_organizationId_status_idx" ON "order_returns"("organizationId", "status");

-- CreateIndex
CREATE INDEX "order_returns_orderId_idx" ON "order_returns"("orderId");

-- CreateIndex
CREATE INDEX "order_return_lines_returnId_idx" ON "order_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "order_return_lines_orderLineItemId_idx" ON "order_return_lines"("orderLineItemId");

-- CreateIndex
CREATE INDEX "order_refunds_orderId_idx" ON "order_refunds"("orderId");

-- CreateIndex
CREATE INDEX "order_refunds_organizationId_idx" ON "order_refunds"("organizationId");

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_lines" ADD CONSTRAINT "order_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "order_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_lines" ADD CONSTRAINT "order_return_lines_orderLineItemId_fkey" FOREIGN KEY ("orderLineItemId") REFERENCES "order_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "order_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Bring an order together at one store (ROADMAP Phase 9.7).
--
-- Organization: the merchant's choice for a bag no single store holds — send
-- each store's part separately (the default, unchanged for everyone), or bring
-- it to one store first for a fee per store and some extra time.
--
-- StockTransfer: REQUESTED (asked for by an order, nothing moved yet), and the
-- order and parcel a transfer is travelling for. Existing transfers are
-- untouched: they keep their status and have no order.
--
-- Hand-written rather than `migrate dev`, which would also rewrite the
-- unrelated orders.customerId drift on the dev database (see Phase 8.6 notes).

-- AlterEnum
ALTER TYPE "StockTransferStatus" ADD VALUE 'REQUESTED' BEFORE 'DISPATCHED';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "consolidateOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "consolidationFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "consolidationLeadMinutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN "consolidationLeadUnit" "DeliveryEtaUnit" NOT NULL DEFAULT 'DAYS';

ALTER TABLE "stock_transfers" ADD COLUMN "orderId" TEXT,
ADD COLUMN "requestedAt" TIMESTAMP(3),
ADD COLUMN "shipmentId" TEXT;

-- CreateIndex
CREATE INDEX "stock_transfers_orderId_idx" ON "stock_transfers"("orderId");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "order_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

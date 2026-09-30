-- One row per parcel of an online order (ROADMAP Phase 9.4).
--
-- BACKFILL. Every online order that had a delivery gets its parcels from
-- where its stock was held: one shipment per store in its allocations, the
-- store that held the most units first. That first parcel carries the order's
-- delivery option and fee; any other store's parcel (orders from before 9.3
-- could be split across stores and were still charged once) carries the same
-- option at a fee of 0 — which is what actually happened, not a guess at a
-- split nobody made. An order with no allocations at all (from before stock
-- was held per store) gets one parcel with no store.
--
-- Status follows the order: shipped → DISPATCHED, delivered → DELIVERED,
-- cancelled → CANCELLED, anything earlier → PENDING. Counter sales have no
-- delivery and get no shipments.
--
-- Hand-written rather than `migrate dev`, which would also rewrite the
-- unrelated orders.customerId drift on the dev database (see Phase 8.6 notes).

-- CreateEnum
CREATE TYPE "OrderShipmentKind" AS ENUM ('DELIVERY', 'PICKUP');
CREATE TYPE "OrderShipmentStatus" AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "order_stock_allocations" ADD COLUMN "shipmentId" TEXT;

-- CreateTable
CREATE TABLE "order_shipments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "kind" "OrderShipmentKind" NOT NULL DEFAULT 'DELIVERY',
    "deliveryMethodId" TEXT NOT NULL,
    "deliveryMethodLabel" TEXT NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "freeOverApplied" BOOLEAN NOT NULL DEFAULT false,
    "etaMinMinutes" INTEGER,
    "etaMaxMinutes" INTEGER,
    "etaUnit" "DeliveryEtaUnit",
    "status" "OrderShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "trackingNote" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_shipments_organizationId_idx" ON "order_shipments"("organizationId");
CREATE INDEX "order_shipments_orderId_idx" ON "order_shipments"("orderId");
CREATE INDEX "order_shipments_warehouseId_idx" ON "order_shipments"("warehouseId");
CREATE INDEX "order_stock_allocations_shipmentId_idx" ON "order_stock_allocations"("shipmentId");

-- AddForeignKey
ALTER TABLE "order_stock_allocations" ADD CONSTRAINT "order_stock_allocations_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "order_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: parcels from where each online order's stock was held.
INSERT INTO "order_shipments" (
  "id", "organizationId", "orderId", "warehouseId", "kind", "deliveryMethodId", "deliveryMethodLabel",
  "fee", "freeOverApplied", "etaMinMinutes", "etaMaxMinutes", "etaUnit", "status",
  "dispatchedAt", "deliveredAt", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  o."organizationId",
  o."id",
  s."warehouseId",
  CASE WHEN o."deliveryMethodId" LIKE 'pickup\_%' THEN 'PICKUP'::"OrderShipmentKind" ELSE 'DELIVERY'::"OrderShipmentKind" END,
  o."deliveryMethodId",
  coalesce(o."deliveryMethodLabel", 'Delivery'),
  CASE WHEN coalesce(s.rn, 1) = 1 THEN coalesce(o."deliveryFee", 0) ELSE 0 END,
  false,
  o."deliveryEtaMinMinutes",
  o."deliveryEtaMaxMinutes",
  o."deliveryEtaUnit",
  CASE o."status"
    WHEN 'SHIPPED' THEN 'DISPATCHED'::"OrderShipmentStatus"
    WHEN 'DELIVERED' THEN 'DELIVERED'::"OrderShipmentStatus"
    WHEN 'CANCELLED' THEN 'CANCELLED'::"OrderShipmentStatus"
    ELSE 'PENDING'::"OrderShipmentStatus"
  END,
  CASE WHEN o."status" IN ('SHIPPED', 'DELIVERED') THEN o."shippedAt" END,
  CASE WHEN o."status" = 'DELIVERED' THEN o."deliveredAt" END,
  coalesce(s.rn, 1) - 1,
  o."placedAt",
  NOW()
FROM "orders" o
LEFT JOIN LATERAL (
  SELECT a."warehouseId", row_number() OVER (ORDER BY sum(a."quantity") DESC, a."warehouseId") AS rn
  FROM "order_stock_allocations" a
  WHERE a."orderId" = o."id"
  GROUP BY a."warehouseId"
) s ON true
WHERE o."channel" = 'ONLINE' AND o."deliveryMethodId" IS NOT NULL;

UPDATE "order_stock_allocations" a
SET "shipmentId" = sh."id"
FROM "order_shipments" sh
WHERE sh."orderId" = a."orderId" AND sh."warehouseId" = a."warehouseId" AND a."shipmentId" IS NULL;

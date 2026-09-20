-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'PARTIALLY_PICKED', 'PICKED', 'PARTIALLY_PACKED', 'PACKED', 'SHIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "inventory_levels" ADD COLUMN     "reservedQty" DECIMAL(12,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "fulfillments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "notes" TEXT,
    "pickedById" TEXT,
    "packedById" TEXT,
    "shippedById" TEXT,
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_line_items" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT NOT NULL,
    "invoiceLineItemId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "pickedQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "packedQty" DECIMAL(12,4) NOT NULL DEFAULT 0,

    CONSTRAINT "fulfillment_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fulfillments_invoiceId_key" ON "fulfillments"("invoiceId");

-- CreateIndex
CREATE INDEX "fulfillments_organizationId_idx" ON "fulfillments"("organizationId");

-- CreateIndex
CREATE INDEX "fulfillments_warehouseId_idx" ON "fulfillments"("warehouseId");

-- CreateIndex
CREATE INDEX "fulfillment_line_items_fulfillmentId_idx" ON "fulfillment_line_items"("fulfillmentId");

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_line_items" ADD CONSTRAINT "fulfillment_line_items_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "fulfillments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_line_items" ADD CONSTRAINT "fulfillment_line_items_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "invoice_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_line_items" ADD CONSTRAINT "fulfillment_line_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

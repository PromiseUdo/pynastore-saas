-- CreateEnum
CREATE TYPE "OrderStockAllocationStatus" AS ENUM ('RESERVED', 'DISPATCHED', 'RELEASED');

-- AlterTable
ALTER TABLE "order_payments" ADD COLUMN     "nativeApp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelReason" TEXT;

-- CreateTable
CREATE TABLE "order_stock_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineItemId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "status" "OrderStockAllocationStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_stock_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_stock_allocations_orderId_idx" ON "order_stock_allocations"("orderId");

-- CreateIndex
CREATE INDEX "order_stock_allocations_inventoryItemId_warehouseId_idx" ON "order_stock_allocations"("inventoryItemId", "warehouseId");

-- AddForeignKey
ALTER TABLE "order_stock_allocations" ADD CONSTRAINT "order_stock_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stock_allocations" ADD CONSTRAINT "order_stock_allocations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stock_allocations" ADD CONSTRAINT "order_stock_allocations_orderLineItemId_fkey" FOREIGN KEY ("orderLineItemId") REFERENCES "order_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stock_allocations" ADD CONSTRAINT "order_stock_allocations_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stock_allocations" ADD CONSTRAINT "order_stock_allocations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


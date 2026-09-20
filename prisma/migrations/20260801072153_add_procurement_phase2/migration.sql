-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "preferredSupplierId" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "warehouseId" TEXT;

-- CreateIndex
CREATE INDEX "inventory_items_preferredSupplierId_idx" ON "inventory_items"("preferredSupplierId");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

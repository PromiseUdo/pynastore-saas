-- AlterTable
ALTER TABLE "invoice_line_items" ADD COLUMN     "dropShipPurchaseOrderId" TEXT,
ADD COLUMN     "isDropShip" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "customerId" TEXT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_dropShipPurchaseOrderId_fkey" FOREIGN KEY ("dropShipPurchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

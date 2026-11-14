-- Wholesale: one wholesale price per product, and VAT added for trade buyers (ROADMAP 21.2).

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "wholesaleVatAdded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "wholesalePrice" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "vatAddedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_line_items" ADD COLUMN     "atWholesalePrice" BOOLEAN NOT NULL DEFAULT false;


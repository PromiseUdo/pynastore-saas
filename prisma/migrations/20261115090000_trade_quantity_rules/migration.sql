-- Wholesale: trade quantity rules — minimums, packs and a minimum order value (ROADMAP 21.3).

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "tradeMinOrderValue" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "tradeMinQuantity" INTEGER,
ADD COLUMN     "tradePackSize" INTEGER;


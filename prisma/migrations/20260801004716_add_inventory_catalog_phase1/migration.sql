/*
  Warnings:

  - You are about to drop the column `category` on the `inventory_items` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('STANDARD', 'VARIANT', 'KIT');

-- AlterTable
ALTER TABLE "inventory_items" DROP COLUMN "category",
ADD COLUMN     "averageCost" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "itemType" "ItemType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "parentItemId" TEXT,
ADD COLUMN     "sellingPrice" DECIMAL(12,2),
ADD COLUMN     "variantAttributes" JSONB,
ADD COLUMN     "variantOptions" JSONB;

-- AlterTable
ALTER TABLE "inventory_levels" ADD COLUMN     "reorderPoint" DECIMAL(12,4),
ADD COLUMN     "reorderQty" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "unitCost" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_components" (
    "id" TEXT NOT NULL,
    "kitItemId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "kit_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_organizationId_idx" ON "categories"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_organizationId_parentId_name_key" ON "categories"("organizationId", "parentId", "name");

-- CreateIndex
CREATE INDEX "kit_components_kitItemId_idx" ON "kit_components"("kitItemId");

-- CreateIndex
CREATE UNIQUE INDEX "kit_components_kitItemId_componentItemId_key" ON "kit_components"("kitItemId", "componentItemId");

-- CreateIndex
CREATE INDEX "inventory_items_categoryId_idx" ON "inventory_items"("categoryId");

-- CreateIndex
CREATE INDEX "inventory_items_parentItemId_idx" ON "inventory_items"("parentItemId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "inventory_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_kitItemId_fkey" FOREIGN KEY ("kitItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

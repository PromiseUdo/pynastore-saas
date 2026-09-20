-- CreateEnum
CREATE TYPE "CollectionKind" AS ENUM ('CURATED', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "CollectionSort" AS ENUM ('RELEVANCE', 'NEWEST', 'PRICE_ASC', 'PRICE_DESC', 'BESTSELLING');

-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "logoPublicId" TEXT;

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "heroImageUrl" TEXT,
    "heroPublicId" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" "CollectionKind" NOT NULL DEFAULT 'CURATED',
    "sort" "CollectionSort" NOT NULL DEFAULT 'RELEVANCE',
    "matchCategoryId" TEXT,
    "matchTag" TEXT,
    "matchMinPrice" DECIMAL(12,2),
    "matchMaxPrice" DECIMAL(12,2),
    "matchCreatedWithinDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "collectionId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("collectionId","inventoryItemId")
);

-- CreateIndex
CREATE INDEX "collections_organizationId_idx" ON "collections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "collections_organizationId_name_key" ON "collections"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "collections_organizationId_slug_key" ON "collections"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "collection_items_inventoryItemId_idx" ON "collection_items"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_matchCategoryId_fkey" FOREIGN KEY ("matchCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


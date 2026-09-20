-- Search by image: pgvector + product-image embeddings.
--
-- pgvector ships with Neon (and most managed Postgres); this only enables it
-- for this database. IF NOT EXISTS keeps the migration safe to re-run.
CREATE EXTENSION IF NOT EXISTS vector;

-- No ANN (HNSW/IVFFlat) index on purpose: every search is filtered to ONE
-- store, whose images number in the hundreds or low thousands, and an exact
-- scan of that set is milliseconds and never misses a true neighbour. An ANN
-- index combined with a tenant WHERE can silently drop results. Revisit if a
-- single store passes ~50k images (see lib/storefront/visual-search/vector-store.ts).

-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'INDEXED', 'FAILED');

-- CreateTable
CREATE TABLE "product_image_embeddings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productImageId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "status" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "embedding" vector(768),
    "model" TEXT,
    "dimensions" INTEGER,
    "sourceHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_image_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visual_search_queries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "model" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visual_search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_image_embeddings_productImageId_key" ON "product_image_embeddings"("productImageId");

-- CreateIndex
CREATE INDEX "product_image_embeddings_organizationId_status_idx" ON "product_image_embeddings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "product_image_embeddings_inventoryItemId_idx" ON "product_image_embeddings"("inventoryItemId");

-- CreateIndex
CREATE INDEX "product_image_embeddings_organizationId_sourceHash_idx" ON "product_image_embeddings"("organizationId", "sourceHash");

-- CreateIndex
CREATE INDEX "visual_search_queries_organizationId_idx" ON "visual_search_queries"("organizationId");

-- CreateIndex
CREATE INDEX "visual_search_queries_expiresAt_idx" ON "visual_search_queries"("expiresAt");

-- AddForeignKey
ALTER TABLE "product_image_embeddings" ADD CONSTRAINT "product_image_embeddings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_embeddings" ADD CONSTRAINT "product_image_embeddings_productImageId_fkey" FOREIGN KEY ("productImageId") REFERENCES "product_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_embeddings" ADD CONSTRAINT "product_image_embeddings_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visual_search_queries" ADD CONSTRAINT "visual_search_queries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


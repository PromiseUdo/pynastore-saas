-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "accountName" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "productName" TEXT,
    "productUrl" TEXT,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_posts_organizationId_status_idx" ON "social_posts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "social_posts_organizationId_createdAt_idx" ON "social_posts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "social_posts_connectionId_idx" ON "social_posts"("connectionId");

-- CreateIndex
CREATE INDEX "social_posts_inventoryItemId_idx" ON "social_posts"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_organizationId_idempotencyKey_key" ON "social_posts"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "social_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


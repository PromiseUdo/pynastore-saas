-- CreateEnum
CREATE TYPE "StorePageKind" AS ENUM ('ABOUT', 'DELIVERY_RETURNS', 'FAQ', 'SIZE_GUIDE', 'CONTACT', 'TERMS', 'PRIVACY', 'CUSTOM');

-- CreateTable
CREATE TABLE "store_pages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "StorePageKind" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_pages_organizationId_isPublished_idx" ON "store_pages"("organizationId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "store_pages_organizationId_slug_key" ON "store_pages"("organizationId", "slug");

-- AddForeignKey
ALTER TABLE "store_pages" ADD CONSTRAINT "store_pages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


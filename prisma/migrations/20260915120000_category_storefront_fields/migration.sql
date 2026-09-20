-- Categories double as the online store's department tree.

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "description" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill slugs for existing rows from the name; siblings that collapse to
-- the same slug get a numeric suffix so the unique index below holds.
WITH base AS (
  SELECT id, "organizationId", "parentId",
         COALESCE(NULLIF(trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'category') AS s
  FROM "categories"
), numbered AS (
  SELECT id, s, row_number() OVER (PARTITION BY "organizationId", "parentId", s ORDER BY id) AS n
  FROM base
)
UPDATE "categories" c
SET slug = CASE WHEN numbered.n = 1 THEN numbered.s ELSE numbered.s || '-' || numbered.n END
FROM numbered
WHERE numbered.id = c.id;

ALTER TABLE "categories" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_organizationId_parentId_slug_key" ON "categories"("organizationId", "parentId", "slug");

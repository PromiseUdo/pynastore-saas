-- Customer management (docs/ROADMAP.md Phase 4).
--
-- Notes and tags are the merchant's own, internal, and never leave the app.
-- marketingConsent is a prerequisite for Phase 5: nothing may be emailed to
-- someone without it, and the date is the part that matters if anyone asks.
-- mergedIntoId lets the same person met twice — a counter sale and an online
-- account — become one record without deleting the history of either.

-- AlterTable
ALTER TABLE "customers"
  ADD COLUMN "notes"            TEXT,
  ADD COLUMN "tags"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consentUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "mergedIntoId"     TEXT,
  ADD COLUMN "mergedAt"         TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "customers_organizationId_mergedIntoId_idx" ON "customers"("organizationId", "mergedIntoId");
CREATE INDEX "customers_mergedIntoId_idx" ON "customers"("mergedIntoId");

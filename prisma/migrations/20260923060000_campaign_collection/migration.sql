-- A collection made from a campaign (docs/ROADMAP.md Phase 5).
--
-- A campaign prices products; it does not make a page. So an announcement
-- had nowhere real to send anyone, and a merchant typing "/anniversary-deals"
-- got a 404 — found out from a customer who followed it.
--
-- The campaign remembers the collection it made, so the button becomes "view
-- it" rather than making a second one, and re-pricing can bring the
-- membership along.

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "collectionId" TEXT;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

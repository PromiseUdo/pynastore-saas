-- A picture for the campaign pop-up (docs/ROADMAP.md Phase 5).
--
-- A sale announcement is a piece of shop-window dressing, and a pop-up with
-- nothing in it but two lines of text looks like an error message. The image
-- is the merchant's own, uploaded through the same signed Cloudinary path as
-- their product photos.

-- AlterTable
ALTER TABLE "campaigns"
  ADD COLUMN "announcementImageUrl"      TEXT,
  ADD COLUMN "announcementImagePublicId" TEXT;

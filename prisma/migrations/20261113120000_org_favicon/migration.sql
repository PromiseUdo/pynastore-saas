-- The online shop's browser-tab icon, separate from the logo.
ALTER TABLE "organizations"
  ADD COLUMN "faviconUrl"      TEXT,
  ADD COLUMN "faviconPublicId" TEXT;

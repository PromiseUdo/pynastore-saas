-- The storefront's own look and listing (docs/ROADMAP.md Phase 6).
--
-- Every storefront opened the same way because there was nowhere for a
-- merchant to say anything of their own: getHomepageSections returned an
-- empty hero because no table stood behind it.
--
-- Every column here is optional. A shop that fills in none of it gets the
-- storefront's defaults rather than something written on its behalf.

-- CreateEnum
CREATE TYPE "HeroAlign" AS ENUM ('LEFT', 'CENTER', 'RIGHT');
CREATE TYPE "HeroTheme" AS ENUM ('LIGHT', 'DARK');

-- AlterTable
ALTER TABLE "organizations"
  ADD COLUMN "storefrontAccent"              TEXT,
  ADD COLUMN "storefrontTagline"             TEXT,
  ADD COLUMN "storefrontSocialImageUrl"      TEXT,
  ADD COLUMN "storefrontSocialImagePublicId" TEXT,
  ADD COLUMN "analyticsGaId"                 TEXT,
  ADD COLUMN "analyticsMetaPixelId"          TEXT;

-- CreateTable
CREATE TABLE "storefront_hero_slides" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eyebrow"        TEXT,
    "title"          TEXT NOT NULL,
    "subtitle"       TEXT,
    "ctaLabel"       TEXT,
    "ctaHref"        TEXT,
    "imageUrl"       TEXT,
    "imagePublicId"  TEXT,
    "align"          "HeroAlign" NOT NULL DEFAULT 'LEFT',
    "theme"          "HeroTheme" NOT NULL DEFAULT 'DARK',
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "isVisible"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_hero_slides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_hero_slides_organizationId_sortOrder_idx"
  ON "storefront_hero_slides"("organizationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "storefront_hero_slides" ADD CONSTRAINT "storefront_hero_slides_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

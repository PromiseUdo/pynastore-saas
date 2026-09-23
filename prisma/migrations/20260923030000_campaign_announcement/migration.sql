-- Telling customers a campaign is on (docs/ROADMAP.md Phase 5).
--
-- The discount is rarely the whole message: "orders for sale items ship from
-- the 27th" is the sort of thing a merchant needs to say alongside it, and
-- had nowhere to say it.
--
-- NONE is the default, and empty text turns the announcement off whatever the
-- style says. A shop that writes nothing announces nothing — nothing here is
-- generated on a merchant's behalf.

-- CreateEnum
CREATE TYPE "CampaignAnnouncementStyle" AS ENUM ('NONE', 'BAR', 'MODAL');

-- AlterTable
ALTER TABLE "campaigns"
  ADD COLUMN "announcementStyle"  "CampaignAnnouncementStyle" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "announcementText"   TEXT,
  ADD COLUMN "announcementDetail" TEXT,
  ADD COLUMN "announcementCta"    TEXT,
  ADD COLUMN "announcementHref"   TEXT,
  ADD COLUMN "announcementBg"     TEXT,
  ADD COLUMN "announcementFg"     TEXT,
  ADD COLUMN "announcementScroll" BOOLEAN NOT NULL DEFAULT false;

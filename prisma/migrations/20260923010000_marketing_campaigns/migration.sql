-- Marketing campaigns (docs/ROADMAP.md Phase 5).
--
-- A sale is NOT a price edit. `inventory_items.sellingPrice` stays what the
-- thing costs; a campaign writes a `campaign_prices` row per targeted product
-- with an end date. Editing sellingPrice instead would lose the real price the
-- moment a sale started, and a shop that forgot would sell at the sale price
-- forever.
--
-- ACTIVE and ENDED are not stored: a campaign is live when the clock is inside
-- its window. Nothing has to flip on time, so nothing can fail to.

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'CANCELLED');
CREATE TYPE "CampaignMechanic" AS ENUM ('PERCENT_OFF', 'FIXED_OFF');
CREATE TYPE "CampaignTargetKind" AS ENUM ('PRODUCT', 'COLLECTION', 'CATEGORY', 'STORE');

-- CreateTable
CREATE TABLE "campaigns" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "description"    TEXT,
    "status"         "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "mechanic"       "CampaignMechanic" NOT NULL,
    "value"          DECIMAL(12,2) NOT NULL,
    "startsAt"       TIMESTAMP(3) NOT NULL,
    "endsAt"         TIMESTAMP(3),
    "targetKind"     "CampaignTargetKind" NOT NULL,
    "targetIds"      TEXT[] DEFAULT ARRAY[]::TEXT[],
    "endedAt"        TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_prices" (
    "id"              TEXT NOT NULL,
    "organizationId"  TEXT NOT NULL,
    "campaignId"      TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "originalPrice"   DECIMAL(12,2) NOT NULL,
    "price"           DECIMAL(12,2) NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_prices_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "social_posts"   ADD COLUMN "campaignId" TEXT;

-- CreateIndex
CREATE INDEX "campaigns_organizationId_status_startsAt_idx" ON "campaigns"("organizationId", "status", "startsAt");
CREATE UNIQUE INDEX "campaign_prices_campaignId_inventoryItemId_key" ON "campaign_prices"("campaignId", "inventoryItemId");
CREATE INDEX "campaign_prices_organizationId_inventoryItemId_idx" ON "campaign_prices"("organizationId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_prices" ADD CONSTRAINT "campaign_prices_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_prices" ADD CONSTRAINT "campaign_prices_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_prices" ADD CONSTRAINT "campaign_prices_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

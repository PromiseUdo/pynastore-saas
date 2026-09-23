-- Settings → General (docs/ROADMAP.md Phase 0.2/0.3).
--
-- Adds the org's trading currency and contact details, and corrects the
-- "USD" defaults on the three merchant-facing documents. Those defaults were
-- never true: the app formats every amount in naira (lib/format.ts) and only
-- NGN is offered, so existing rows are backfilled rather than left claiming a
-- currency the business does not trade in.

-- AlterTable
ALTER TABLE "organizations"
  ADD COLUMN "currency"        TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN "supportEmail"    TEXT,
  ADD COLUMN "supportPhone"    TEXT,
  ADD COLUMN "businessAddress" TEXT,
  ADD COLUMN "logoPublicId"    TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ALTER COLUMN "currency" SET DEFAULT 'NGN';
ALTER TABLE "quotes"          ALTER COLUMN "currency" SET DEFAULT 'NGN';
ALTER TABLE "invoices"        ALTER COLUMN "currency" SET DEFAULT 'NGN';

-- Backfill: every existing document takes its organization's currency.
UPDATE "purchase_orders" po
   SET "currency" = o."currency"
  FROM "organizations" o
 WHERE o."id" = po."organizationId" AND po."currency" = 'USD';

UPDATE "quotes" q
   SET "currency" = o."currency"
  FROM "organizations" o
 WHERE o."id" = q."organizationId" AND q."currency" = 'USD';

UPDATE "invoices" i
   SET "currency" = o."currency"
  FROM "organizations" o
 WHERE o."id" = i."organizationId" AND i."currency" = 'USD';

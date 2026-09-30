-- ROADMAP 12.1, part 2 of 2: the plan catalogue moves into the database, and
-- the FREE plan (the OrganizationPlan enum) goes.
--
-- Hand-written, because it MOVES data: existing subscriptions, Paystack plan
-- codes and billing history are pointed at the seeded catalogue rows before
-- the old enum columns are dropped. (The known orders.customerId drift,
-- ROADMAP 8.6, is not touched.)
--
-- Seeded from DEFAULT_CATALOGUE / DEFAULT_DISCOUNTS in lib/billing/plans.ts:
-- Starter ₦5,000 a month, Pro ₦45,000, Enterprise ₦150,000; 10% off for six
-- months, 17% off for a year. API access is not sold (not built).
--
-- Workspaces on FREE are test data (ROADMAP 12.1): they are given no plan and
-- no subscription — nothing is built for them.

-- 1. The catalogue ------------------------------------------------------------

CREATE TABLE "billing_plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "monthlyPrice" DECIMAL(12,2) NOT NULL,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isOnSale" BOOLEAN NOT NULL DEFAULT true,
    "maxSeats" INTEGER,
    "maxWarehouses" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_plans_key_key" ON "billing_plans"("key");

CREATE TABLE "billing_plan_prices" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "billing_plan_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_plan_prices_planId_billingCycle_key" ON "billing_plan_prices"("planId", "billingCycle");
ALTER TABLE "billing_plan_prices" ADD CONSTRAINT "billing_plan_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_plan_features" (
    "planId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    CONSTRAINT "billing_plan_features_pkey" PRIMARY KEY ("planId","feature")
);
ALTER TABLE "billing_plan_features" ADD CONSTRAINT "billing_plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "billing_plans" ("id", "key", "name", "tagline", "monthlyPrice", "highlighted", "sortOrder", "isOnSale", "maxSeats", "maxWarehouses", "updatedAt") VALUES
  ('bplan_starter',    'starter',    'Starter',    'For a small shop getting started',               5000,   false, 1, true, 10,   1,    CURRENT_TIMESTAMP),
  ('bplan_pro',        'pro',        'Pro',        'Sell from several stores, with the full toolkit', 45000,  true,  2, true, 50,   NULL, CURRENT_TIMESTAMP),
  ('bplan_enterprise', 'enterprise', 'Enterprise', 'Unlimited team and stores',                        150000, false, 3, true, NULL, NULL, CURRENT_TIMESTAMP);

-- cyclePrice(monthly, cycle, discount) = round(monthly × months × (1 − discount%))
INSERT INTO "billing_plan_prices" ("id", "planId", "billingCycle", "discountPct", "amount") VALUES
  ('bprice_starter_m',    'bplan_starter',    'MONTHLY',  0,  5000),
  ('bprice_starter_b',    'bplan_starter',    'BIANNUAL', 10, 27000),
  ('bprice_starter_y',    'bplan_starter',    'YEARLY',   17, 49800),
  ('bprice_pro_m',        'bplan_pro',        'MONTHLY',  0,  45000),
  ('bprice_pro_b',        'bplan_pro',        'BIANNUAL', 10, 243000),
  ('bprice_pro_y',        'bplan_pro',        'YEARLY',   17, 448200),
  ('bprice_enterprise_m', 'bplan_enterprise', 'MONTHLY',  0,  150000),
  ('bprice_enterprise_b', 'bplan_enterprise', 'BIANNUAL', 10, 810000),
  ('bprice_enterprise_y', 'bplan_enterprise', 'YEARLY',   17, 1494000);

INSERT INTO "billing_plan_features" ("planId", "feature")
SELECT p.id, f.feature
FROM "billing_plans" p
CROSS JOIN (VALUES
  ('inventory.module'), ('sales.module'), ('procurement.module'), ('roles.custom')
) AS f(feature);

INSERT INTO "billing_plan_features" ("planId", "feature")
SELECT p.id, f.feature
FROM "billing_plans" p
CROSS JOIN (VALUES
  ('inventory.multi_warehouse'), ('inventory.kits'), ('procurement.auto_reorder'),
  ('reports.advanced'), ('audit_log.export')
) AS f(feature)
WHERE p.key IN ('pro', 'enterprise');

-- 2. Subscriptions: plan enum → catalogue row, the price they were paying ----

ALTER TABLE "subscriptions"
  ADD COLUMN "planId" TEXT,
  ADD COLUMN "amount" DECIMAL(12,2),
  ADD COLUMN "trialStartedAt" TIMESTAMP(3),
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "lapsedAt" TIMESTAMP(3),
  ADD COLUMN "graceEndsAt" TIMESTAMP(3);

UPDATE "subscriptions" SET
  "planId" = CASE "plan"::text
    WHEN 'STARTER' THEN 'bplan_starter'
    WHEN 'PRO' THEN 'bplan_pro'
    WHEN 'ENTERPRISE' THEN 'bplan_enterprise'
    ELSE NULL END,
  -- What the old catalogue charged, per cycle, so an existing subscriber's
  -- price doesn't move (the old yearly price was ten months).
  "amount" = CASE "plan"::text
    WHEN 'STARTER' THEN 15000
    WHEN 'PRO' THEN 45000
    WHEN 'ENTERPRISE' THEN 150000
    ELSE NULL END * CASE "billingCycle"::text WHEN 'YEARLY' THEN 10 ELSE 1 END;

ALTER TABLE "subscriptions" DROP COLUMN "plan";
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Paystack plan codes: keyed by plan, cycle AND price (kobo) ---------------

ALTER TABLE "billing_plan_codes" ADD COLUMN "planId" TEXT, ADD COLUMN "amount" INTEGER;

UPDATE "billing_plan_codes" SET
  "planId" = CASE "plan"::text
    WHEN 'STARTER' THEN 'bplan_starter'
    WHEN 'PRO' THEN 'bplan_pro'
    WHEN 'ENTERPRISE' THEN 'bplan_enterprise'
    ELSE NULL END,
  "amount" = CASE "plan"::text
    WHEN 'STARTER' THEN 15000
    WHEN 'PRO' THEN 45000
    WHEN 'ENTERPRISE' THEN 150000
    ELSE 0 END * CASE "billingCycle"::text WHEN 'YEARLY' THEN 10 ELSE 1 END * 100;

-- A code for the FREE plan, if one was ever made, has no plan to belong to.
DELETE FROM "billing_plan_codes" WHERE "planId" IS NULL;

DROP INDEX "billing_plan_codes_plan_billingCycle_key";
ALTER TABLE "billing_plan_codes" DROP COLUMN "plan";
ALTER TABLE "billing_plan_codes" ALTER COLUMN "planId" SET NOT NULL, ALTER COLUMN "amount" SET NOT NULL;
CREATE UNIQUE INDEX "billing_plan_codes_planId_billingCycle_amount_key" ON "billing_plan_codes"("planId", "billingCycle", "amount");
ALTER TABLE "billing_plan_codes" ADD CONSTRAINT "billing_plan_codes_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Billing history: point at the catalogue, keep the name charged ----------

ALTER TABLE "billing_transactions" ADD COLUMN "planId" TEXT, ADD COLUMN "planName" TEXT;

UPDATE "billing_transactions" SET
  "planId" = CASE "plan"::text
    WHEN 'STARTER' THEN 'bplan_starter'
    WHEN 'PRO' THEN 'bplan_pro'
    WHEN 'ENTERPRISE' THEN 'bplan_enterprise'
    ELSE NULL END,
  "planName" = CASE "plan"::text
    WHEN 'STARTER' THEN 'Starter'
    WHEN 'PRO' THEN 'Pro'
    WHEN 'ENTERPRISE' THEN 'Enterprise'
    ELSE 'Free' END;

ALTER TABLE "billing_transactions" DROP COLUMN "plan";
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. The FREE plan goes ---------------------------------------------------------

ALTER TABLE "organizations" DROP COLUMN "plan";
DROP TYPE "OrganizationPlan";

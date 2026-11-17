-- ROADMAP 22.3: a free .com.ng for the first year on yearly plans that include it.
ALTER TABLE "organizations" ADD COLUMN "freeDomainClaimedAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "isFree" BOOLEAN NOT NULL DEFAULT false;

-- Agreed 2026-11-17: Growth (key 'pro') and Business (key 'enterprise') include it.
-- Staff can change this in the console's plan editor.
INSERT INTO "billing_plan_features" ("planId", "feature")
SELECT "id", 'domain.free_com_ng' FROM "billing_plans" WHERE "key" IN ('pro', 'enterprise')
ON CONFLICT DO NOTHING;

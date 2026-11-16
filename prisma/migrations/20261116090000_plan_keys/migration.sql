-- ROADMAP 22.1: plan keys that lock what they say.

-- A monthly limit on AI-written social copy; null = unlimited (today's behaviour).
ALTER TABLE "billing_plans" ADD COLUMN "maxAiCaptions" INTEGER;

-- Three new keys. Every existing plan gets them, so no shop loses anything on
-- deploy; staff take them off plans in the console when the new spread is set.
INSERT INTO "billing_plan_features" ("planId", "feature")
SELECT p.id, f.feature
FROM "billing_plans" p
CROSS JOIN (VALUES ('marketing.campaigns'), ('sales.wholesale'), ('storefront.ai_shopping')) AS f(feature)
ON CONFLICT DO NOTHING;

-- "More than one store" never gated anything: the store limit is the rule.
DELETE FROM "billing_plan_features" WHERE "feature" = 'inventory.multi_warehouse';

-- The owner's plan names (2026-11-14). Only if staff haven't renamed them already.
UPDATE "billing_plans" SET "name" = 'Growth' WHERE "key" = 'pro' AND "name" = 'Pro';
UPDATE "billing_plans" SET "name" = 'Business' WHERE "key" = 'enterprise' AND "name" = 'Enterprise';

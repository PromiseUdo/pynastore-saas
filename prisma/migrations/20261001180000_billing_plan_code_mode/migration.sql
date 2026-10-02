-- ROADMAP 13.9: a Paystack plan belongs to one mode; every plan so far was made in test mode.
ALTER TABLE "billing_plan_codes" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'test';
DROP INDEX "billing_plan_codes_planId_billingCycle_amount_key";
CREATE UNIQUE INDEX "billing_plan_codes_planId_billingCycle_amount_mode_key" ON "billing_plan_codes"("planId", "billingCycle", "amount", "mode");

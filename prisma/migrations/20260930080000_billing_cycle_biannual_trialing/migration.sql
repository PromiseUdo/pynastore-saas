-- ROADMAP 12.1, part 1 of 2: the six-month billing cycle (Paystack's
-- `biannually`) and the TRIALING subscription status. On their own, because
-- Postgres can't use a new enum value in the transaction that adds it, and
-- part 2 seeds prices with BIANNUAL.
ALTER TYPE "BillingCycle" ADD VALUE IF NOT EXISTS 'BIANNUAL';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'TRIALING';

-- ROADMAP 10.3: cache Paystack's view of a merchant's subaccount, and when it
-- was last read. Additive; no existing row changes.
ALTER TABLE "merchant_payment_accounts" ADD COLUMN "paystackIsVerified" BOOLEAN;
ALTER TABLE "merchant_payment_accounts" ADD COLUMN "paystackSyncedAt" TIMESTAMP(3);

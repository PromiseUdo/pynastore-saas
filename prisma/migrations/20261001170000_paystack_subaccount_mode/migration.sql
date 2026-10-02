-- ROADMAP 13.9: which Paystack mode made each merchant's subaccount. Every
-- subaccount so far was made with a test key — live payments hadn't started.
ALTER TABLE "merchant_payment_accounts" ADD COLUMN "paystackSubaccountMode" TEXT;
UPDATE "merchant_payment_accounts" SET "paystackSubaccountMode" = 'test' WHERE "paystackSubaccountCode" IS NOT NULL;

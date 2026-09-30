-- ROADMAP 10.4: each online payment attempt records the Paystack subaccount it
-- was sent to, and Paystack's own split of the money once verified. Additive;
-- existing (Squad) attempts keep NULLs.
ALTER TABLE "order_payments" ADD COLUMN "subaccountCode" TEXT;
ALTER TABLE "order_payments" ADD COLUMN "merchantAmount" DECIMAL(12,2);
ALTER TABLE "order_payments" ADD COLUMN "platformAmount" DECIMAL(12,2);
ALTER TABLE "order_payments" ADD COLUMN "feeAmount" DECIMAL(12,2);

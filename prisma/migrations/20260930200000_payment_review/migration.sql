-- ROADMAP 11.6: staff review of payment problems, and payments that matched nothing.
ALTER TABLE "order_payments" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "order_payments" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "order_payments" ADD COLUMN "reviewNote" TEXT;

CREATE TABLE "unmatched_payments" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "subaccountCode" TEXT,
    "customerEmail" TEXT,
    "payload" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "unmatched_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "unmatched_payments_kind_reference_key" ON "unmatched_payments"("kind", "reference");
CREATE INDEX "unmatched_payments_resolvedAt_idx" ON "unmatched_payments"("resolvedAt");

-- Wallet top-ups through EduPay and Paystack (ROADMAP 20.3), and wallet records keyed by EduPay mode (test/live) rather than server address.

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('SHOPPER', 'SHOP');

-- CreateEnum
CREATE TYPE "WalletTopUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- AlterTable: which EduPay mode the record belongs to, instead of which address.
-- Renamed, not dropped; every record so far was made on EduPay's test server.
ALTER TABLE "shop_wallets" RENAME COLUMN "serviceUrl" TO "environment";
UPDATE "shop_wallets" SET "environment" = 'test' WHERE "environment" IS NOT NULL;

-- AlterTable: which EduPay mode the record belongs to, instead of which address.
-- Renamed, not dropped; every record so far was made on EduPay's test server.
ALTER TABLE "shopper_wallets" RENAME COLUMN "serviceUrl" TO "environment";
UPDATE "shopper_wallets" SET "environment" = 'test' WHERE "environment" IS NOT NULL;

-- CreateTable
CREATE TABLE "wallet_top_ups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "WalletKind" NOT NULL,
    "customerId" TEXT,
    "startedById" TEXT,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "WalletTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "environment" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "reportedPaidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_ups_reference_key" ON "wallet_top_ups"("reference");

-- CreateIndex
CREATE INDEX "wallet_top_ups_organizationId_kind_status_idx" ON "wallet_top_ups"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "wallet_top_ups_customerId_idx" ON "wallet_top_ups"("customerId");

-- CreateIndex
CREATE INDEX "wallet_top_ups_status_createdAt_idx" ON "wallet_top_ups"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


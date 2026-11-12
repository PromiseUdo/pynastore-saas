-- CreateEnum
CREATE TYPE "WalletWithdrawalStatus" AS ENUM ('AWAITING_CODE', 'CONFIRMING', 'SENT', 'RETURNED', 'FAILED', 'EXPIRED');
-- CreateTable
CREATE TABLE "wallet_withdrawals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "WalletWithdrawalStatus" NOT NULL DEFAULT 'AWAITING_CODE',
    "amount" DECIMAL(12,2) NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT,
    "requestedById" TEXT,
    "confirmedById" TEXT,
    "gatewayRef" TEXT,
    "lastError" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wallet_withdrawals_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "wallet_withdrawals_reference_key" ON "wallet_withdrawals"("reference");
-- CreateIndex
CREATE INDEX "wallet_withdrawals_organizationId_createdAt_idx" ON "wallet_withdrawals"("organizationId", "createdAt");
-- CreateIndex
CREATE INDEX "wallet_withdrawals_status_createdAt_idx" ON "wallet_withdrawals"("status", "createdAt");
-- AddForeignKey
ALTER TABLE "wallet_withdrawals" ADD CONSTRAINT "wallet_withdrawals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

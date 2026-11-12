-- Shopper accounts' EduPay wallets (ROADMAP 20.2).

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('PENDING', 'ACTIVE', 'PHONE_IN_USE', 'FAILED');

-- CreateEnum
CREATE TYPE "WalletOrigin" AS ENUM ('CREATED', 'CONNECTED');

-- CreateTable
CREATE TABLE "shopper_wallets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'PENDING',
    "origin" "WalletOrigin",
    "userRef" TEXT NOT NULL,
    "edupayUuid" TEXT,
    "edupayUniqId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopper_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopper_wallets_customerId_key" ON "shopper_wallets"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "shopper_wallets_userRef_key" ON "shopper_wallets"("userRef");

-- CreateIndex
CREATE INDEX "shopper_wallets_organizationId_idx" ON "shopper_wallets"("organizationId");

-- CreateIndex
CREATE INDEX "shopper_wallets_status_nextAttemptAt_idx" ON "shopper_wallets"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "shopper_wallets_edupayUuid_idx" ON "shopper_wallets"("edupayUuid");

-- AddForeignKey
ALTER TABLE "shopper_wallets" ADD CONSTRAINT "shopper_wallets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_wallets" ADD CONSTRAINT "shopper_wallets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


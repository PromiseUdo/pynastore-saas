-- Shops' EduPay wallets (ROADMAP 20.4), and which EduPay server each wallet record belongs to.

-- AlterTable
ALTER TABLE "shopper_wallets" ADD COLUMN     "serviceUrl" TEXT;

-- CreateTable
CREATE TABLE "shop_wallets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'PENDING',
    "userRef" TEXT NOT NULL,
    "edupayUuid" TEXT,
    "edupayUniqId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "activatedAt" TIMESTAMP(3),
    "serviceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_wallets_organizationId_key" ON "shop_wallets"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "shop_wallets_userRef_key" ON "shop_wallets"("userRef");

-- CreateIndex
CREATE INDEX "shop_wallets_status_nextAttemptAt_idx" ON "shop_wallets"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "shop_wallets" ADD CONSTRAINT "shop_wallets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "transferDetails" JSONB;

-- CreateTable
CREATE TABLE "merchant_bank_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_bank_accounts_organizationId_idx" ON "merchant_bank_accounts"("organizationId");

-- AddForeignKey
ALTER TABLE "merchant_bank_accounts" ADD CONSTRAINT "merchant_bank_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Wholesale: pay on account — credit terms per trade buyer, and payments recorded against orders (ROADMAP 21.5).

-- AlterEnum
ALTER TYPE "OrderPaymentStatus" ADD VALUE 'ON_ACCOUNT';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "tradeAccountDays" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "trade_accounts" ADD COLUMN     "accountDays" INTEGER,
ADD COLUMN     "creditLimit" DECIMAL(12,2),
ADD COLUMN     "onAccount" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accountDueAt" TIMESTAMP(3),
ADD COLUMN     "accountPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "accountReminders" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_account_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_account_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_account_payments_orderId_idx" ON "order_account_payments"("orderId");

-- CreateIndex
CREATE INDEX "order_account_payments_organizationId_idx" ON "order_account_payments"("organizationId");

-- AddForeignKey
ALTER TABLE "order_account_payments" ADD CONSTRAINT "order_account_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_account_payments" ADD CONSTRAINT "order_account_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


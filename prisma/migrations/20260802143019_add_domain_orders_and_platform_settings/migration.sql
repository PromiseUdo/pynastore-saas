-- CreateEnum
CREATE TYPE "DomainOrderType" AS ENUM ('FREE', 'EXISTING', 'REGISTER');

-- CreateEnum
CREATE TYPE "DomainOrderStatus" AS ENUM ('PENDING_FULFILLMENT', 'ACTIVE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "domain_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billingTransactionId" TEXT,
    "type" "DomainOrderType" NOT NULL,
    "domain" TEXT,
    "status" "DomainOrderStatus" NOT NULL DEFAULT 'PENDING_FULFILLMENT',
    "usdPrice" DECIMAL(10,2),
    "ngnPrice" DECIMAL(12,2),
    "exchangeRate" DECIMAL(10,4),
    "notes" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_orders_billingTransactionId_key" ON "domain_orders"("billingTransactionId");

-- CreateIndex
CREATE INDEX "domain_orders_organizationId_idx" ON "domain_orders"("organizationId");

-- CreateIndex
CREATE INDEX "domain_orders_status_idx" ON "domain_orders"("status");

-- AddForeignKey
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_billingTransactionId_fkey" FOREIGN KEY ("billingTransactionId") REFERENCES "billing_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

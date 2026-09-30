-- ROADMAP 12.6 / 11.5: shop domains, renewals, and the staff fulfilment checklist.
ALTER TYPE "DomainOrderType" ADD VALUE IF NOT EXISTS 'RENEW';
CREATE TYPE "ShopDomainSource" AS ENUM ('REGISTERED', 'CONNECTED');
CREATE TYPE "ShopDomainStatus" AS ENUM ('PENDING', 'LIVE', 'EXPIRED', 'DISCONNECTED', 'FAILED');

ALTER TABLE "domain_orders" ADD COLUMN "readyAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "stepRegisteredAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "stepDnsAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "stepHostAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "stepCheckedAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "domain_orders" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "domain_orders" ADD COLUMN "refundAmount" DECIMAL(12,2);
ALTER TABLE "domain_orders" ADD COLUMN "refundReference" TEXT;
ALTER TABLE "domain_orders" ADD COLUMN "handledById" TEXT;

CREATE TABLE "shop_domains" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "canonicalHost" TEXT NOT NULL,
    "source" "ShopDomainSource" NOT NULL,
    "status" "ShopDomainStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "dnsCheckedAt" TIMESTAMP(3),
    "dnsOk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shop_domains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_domains_organizationId_key" ON "shop_domains"("organizationId");
CREATE UNIQUE INDEX "shop_domains_hostname_key" ON "shop_domains"("hostname");
CREATE INDEX "shop_domains_status_expiresAt_idx" ON "shop_domains"("status", "expiresAt");
ALTER TABLE "shop_domains" ADD CONSTRAINT "shop_domains_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "domain_reminders" (
    "id" TEXT NOT NULL,
    "shopDomainId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_reminders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "domain_reminders_shopDomainId_kind_key" ON "domain_reminders"("shopDomainId", "kind");
ALTER TABLE "domain_reminders" ADD CONSTRAINT "domain_reminders_shopDomainId_fkey" FOREIGN KEY ("shopDomainId") REFERENCES "shop_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wholesale: trade buyers (ROADMAP 21.1).

-- CreateEnum
CREATE TYPE "WholesaleMode" AS ENUM ('OFF', 'RETAIL_AND_TRADE', 'TRADE_ONLY');

-- CreateEnum
CREATE TYPE "TradeAccountStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "tradePayOnDelivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tradePayOnline" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tradePayTransfer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "wholesaleMode" "WholesaleMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "wholesaleRequestsOpen" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "trade_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "TradeAccountStatus" NOT NULL,
    "businessName" TEXT NOT NULL,
    "cacNumber" TEXT,
    "requestNote" TEXT,
    "decisionReason" TEXT,
    "requestedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_accounts_customerId_key" ON "trade_accounts"("customerId");

-- CreateIndex
CREATE INDEX "trade_accounts_organizationId_status_idx" ON "trade_accounts"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "trade_accounts" ADD CONSTRAINT "trade_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_accounts" ADD CONSTRAINT "trade_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_accounts" ADD CONSTRAINT "trade_accounts_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Permission: customer.trade.manage (make, approve, decline, suspend trade
-- buyers). The Owner holds every permission without a row
-- (lib/organization.ts); the built-in Admin role is a stored snapshot, so
-- existing Admins are granted it here. Other roles get it from Roles and
-- permissions.
INSERT INTO "permissions" ("id", "key", "module")
VALUES (gen_random_uuid()::text, 'customer.trade.manage', 'customer')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."isSystem" = true
  AND r."name" = 'Admin'
  AND p."key" = 'customer.trade.manage'
ON CONFLICT DO NOTHING;

-- One Order model for every sales channel (docs/ROADMAP.md Phase 2).
--
-- A counter sale could not previously be represented: email, the seven ship*
-- columns, the four delivery* columns and confirmationToken were all NOT NULL
-- and only the storefront checkout could write an Order. Relaxing them here —
-- rather than adding a separate POS table — is what lets stock allocation,
-- returns, customer history and every report cover both halves of the
-- business without a second set of numbers to reconcile.
--
-- Existing rows are all storefront orders, so they are backfilled to ONLINE
-- by the column default BEFORE anything is allowed to be null.

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('ONLINE', 'WALK_IN', 'PHONE');

-- AlterTable: every existing row becomes ONLINE here.
ALTER TABLE "orders"
  ADD COLUMN "channel"      "OrderChannel" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "warehouseId"  TEXT,
  ADD COLUMN "soldByUserId" TEXT;

-- AlterTable: what an online order has and a counter sale does not.
ALTER TABLE "orders"
  ALTER COLUMN "customerId"          DROP NOT NULL,
  ALTER COLUMN "confirmationToken"   DROP NOT NULL,
  ALTER COLUMN "email"               DROP NOT NULL,
  ALTER COLUMN "firstName"           DROP NOT NULL,
  ALTER COLUMN "lastName"            DROP NOT NULL,
  ALTER COLUMN "phone"               DROP NOT NULL,
  ALTER COLUMN "shipFullName"        DROP NOT NULL,
  ALTER COLUMN "shipPhone"           DROP NOT NULL,
  ALTER COLUMN "shipLine1"           DROP NOT NULL,
  ALTER COLUMN "shipCity"            DROP NOT NULL,
  ALTER COLUMN "shipState"           DROP NOT NULL,
  ALTER COLUMN "shipCountry"         DROP NOT NULL,
  ALTER COLUMN "deliveryMethodId"    DROP NOT NULL,
  ALTER COLUMN "deliveryMethodLabel" DROP NOT NULL,
  ALTER COLUMN "deliveryFee"         DROP NOT NULL,
  ALTER COLUMN "deliveryEtaMinDays"  DROP NOT NULL,
  ALTER COLUMN "deliveryEtaMaxDays"  DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_soldByUserId_fkey"
  FOREIGN KEY ("soldByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "orders_organizationId_channel_placedAt_idx" ON "orders"("organizationId", "channel", "placedAt");
CREATE INDEX "orders_warehouseId_idx" ON "orders"("warehouseId");

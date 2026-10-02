-- ROADMAP 13.8: closing a workspace, deleting a shopper account, anonymising after retention.
ALTER TABLE "organizations" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "closedById" TEXT;
ALTER TABLE "organizations" ADD COLUMN "closureReason" TEXT;
ALTER TABLE "organizations" ADD COLUMN "closedDataPurgedAt" TIMESTAMP(3);

ALTER TABLE "customers" ADD COLUMN "accountDeletedAt" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

ALTER TABLE "orders" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

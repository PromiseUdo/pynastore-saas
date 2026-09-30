-- ROADMAP 11.4: why and when platform staff suspended a workspace.
ALTER TABLE "organizations" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "suspensionReason" TEXT;

-- Phones in the business app belong to a staff member, not to one shop (ROADMAP 19.4).

-- AlterTable
ALTER TABLE "push_devices" ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "push_devices_userId_appId_idx" ON "push_devices"("userId", "appId");

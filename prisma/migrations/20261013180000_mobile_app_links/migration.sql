-- Universal Links and App Links for store apps (ROADMAP 18.5).
-- AlterTable
ALTER TABLE "mobile_apps" ADD COLUMN     "androidCertSha256" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "appleTeamId" TEXT;


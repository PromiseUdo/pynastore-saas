-- Daily summary emails for notifications (ROADMAP 18.6).
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "emailedAt" TIMESTAMP(3);


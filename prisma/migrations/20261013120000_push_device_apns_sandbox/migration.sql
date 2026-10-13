-- Remember which phones registered with Apple's test service (ROADMAP 18.4).
-- AlterTable
ALTER TABLE "push_devices" ADD COLUMN     "apnsSandbox" BOOLEAN NOT NULL DEFAULT false;


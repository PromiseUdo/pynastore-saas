-- CreateEnum
CREATE TYPE "AuthTicketPurpose" AS ENUM ('TWO_FACTOR', 'RENEW');
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorEnabledAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorLastStep" INTEGER,
ADD COLUMN     "twoFactorPendingSecret" TEXT,
ADD COLUMN     "twoFactorSecret" TEXT;
-- CreateTable
CREATE TABLE "user_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_recovery_codes_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "auth_tickets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthTicketPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_tickets_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "user_email_changes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_email_changes_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "user_recovery_codes_userId_idx" ON "user_recovery_codes"("userId");
-- CreateIndex
CREATE UNIQUE INDEX "auth_tickets_tokenHash_key" ON "auth_tickets"("tokenHash");
-- CreateIndex
CREATE INDEX "auth_tickets_userId_idx" ON "auth_tickets"("userId");
-- CreateIndex
CREATE INDEX "auth_tickets_expiresAt_idx" ON "auth_tickets"("expiresAt");
-- CreateIndex
CREATE UNIQUE INDEX "user_email_changes_tokenHash_key" ON "user_email_changes"("tokenHash");
-- CreateIndex
CREATE INDEX "user_email_changes_userId_idx" ON "user_email_changes"("userId");
-- AddForeignKey
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "auth_tickets" ADD CONSTRAINT "auth_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "user_email_changes" ADD CONSTRAINT "user_email_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

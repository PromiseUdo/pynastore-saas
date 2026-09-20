-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'TIKTOK');

-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "social_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "platformAccountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "accessTokenCipher" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "SocialConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastCheckedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "parentConnectionId" TEXT,
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_connection_drafts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "SocialPlatform" NOT NULL,
    "payloadCipher" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_connection_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_connections_organizationId_status_idx" ON "social_connections"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_organizationId_platform_platformAccountI_key" ON "social_connections"("organizationId", "platform", "platformAccountId");

-- CreateIndex
CREATE INDEX "social_connection_drafts_organizationId_userId_idx" ON "social_connection_drafts"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "social_connection_drafts_expiresAt_idx" ON "social_connection_drafts"("expiresAt");

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_parentConnectionId_fkey" FOREIGN KEY ("parentConnectionId") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connection_drafts" ADD CONSTRAINT "social_connection_drafts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


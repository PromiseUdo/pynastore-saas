-- ROADMAP 16.1: a store's own phone app, and which app a payment began in.
CREATE TYPE "MobileAppStatus" AS ENUM ('ACTIVE', 'LAPSED');

CREATE TABLE "mobile_apps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MobileAppStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_apps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_apps_organizationId_key" ON "mobile_apps"("organizationId");
CREATE UNIQUE INDEX "mobile_apps_appId_key" ON "mobile_apps"("appId");

ALTER TABLE "mobile_apps" ADD CONSTRAINT "mobile_apps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_payments" ADD COLUMN "nativeAppScheme" TEXT;

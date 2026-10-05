-- ROADMAP 16.2: a store's app as an order — request, payment, build, delivery, renewal.
CREATE TYPE "MobileAppStage" AS ENUM ('REQUESTED', 'PAID', 'BUILDING', 'DELIVERED', 'LIVE');
CREATE TYPE "MobileAppPaymentKind" AS ENUM ('SETUP', 'RENEWAL');

ALTER TABLE "mobile_apps" ADD COLUMN "stage" "MobileAppStage" NOT NULL DEFAULT 'REQUESTED',
ADD COLUMN "wantsAndroid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "wantsIos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "iconUrl" TEXT,
ADD COLUMN "iconPublicId" TEXT,
ADD COLUMN "backgroundColor" TEXT,
ADD COLUMN "shortDescription" TEXT,
ADD COLUMN "requestedById" TEXT,
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "buildingAt" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "liveAt" TIMESTAMP(3),
ADD COLUMN "versionName" TEXT,
ADD COLUMN "buildNumber" INTEGER,
ADD COLUMN "downloadUrl" TEXT,
ADD COLUMN "deliveryNote" TEXT,
ADD COLUMN "handledById" TEXT,
ADD COLUMN "paidThrough" TIMESTAMP(3),
ADD COLUMN "lapsedAt" TIMESTAMP(3),
ADD COLUMN "graceEndsAt" TIMESTAMP(3);

-- Apps registered from the terminal before 16.2 were already built: live if
-- listed anywhere, otherwise delivered.
UPDATE "mobile_apps" SET "stage" = CASE
  WHEN "appStoreId" IS NOT NULL OR "onGooglePlay" THEN 'LIVE'::"MobileAppStage"
  ELSE 'DELIVERED'::"MobileAppStage"
END;

CREATE TABLE "mobile_app_payments" (
    "id" TEXT NOT NULL,
    "mobileAppId" TEXT NOT NULL,
    "billingTransactionId" TEXT NOT NULL,
    "kind" "MobileAppPaymentKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "coversUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_app_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mobile_app_reminders" (
    "id" TEXT NOT NULL,
    "mobileAppId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_app_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_app_payments_billingTransactionId_key" ON "mobile_app_payments"("billingTransactionId");
CREATE INDEX "mobile_app_payments_mobileAppId_idx" ON "mobile_app_payments"("mobileAppId");
CREATE UNIQUE INDEX "mobile_app_reminders_mobileAppId_kind_key" ON "mobile_app_reminders"("mobileAppId", "kind");

ALTER TABLE "mobile_app_payments" ADD CONSTRAINT "mobile_app_payments_mobileAppId_fkey" FOREIGN KEY ("mobileAppId") REFERENCES "mobile_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_app_payments" ADD CONSTRAINT "mobile_app_payments_billingTransactionId_fkey" FOREIGN KEY ("billingTransactionId") REFERENCES "billing_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_app_reminders" ADD CONSTRAINT "mobile_app_reminders_mobileAppId_fkey" FOREIGN KEY ("mobileAppId") REFERENCES "mobile_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

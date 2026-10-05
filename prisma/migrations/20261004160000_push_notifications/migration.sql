-- ROADMAP 16.4: push notifications about an order, in a store's own app.
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS');

ALTER TABLE "mobile_apps" ADD COLUMN "apnsTeamId" TEXT,
ADD COLUMN "apnsKeyId" TEXT,
ADD COLUMN "apnsKeySealed" TEXT;

CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_order_watches" (
    "deviceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_order_watches_pkey" PRIMARY KEY ("deviceId","orderId")
);

CREATE INDEX "push_devices_organizationId_idx" ON "push_devices"("organizationId");
CREATE UNIQUE INDEX "push_devices_appId_token_key" ON "push_devices"("appId", "token");
CREATE INDEX "push_order_watches_orderId_idx" ON "push_order_watches"("orderId");
CREATE INDEX "push_order_watches_createdAt_idx" ON "push_order_watches"("createdAt");

ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_order_watches" ADD CONSTRAINT "push_order_watches_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_order_watches" ADD CONSTRAINT "push_order_watches_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ROADMAP 16.4: where shoppers get a store's app, and whether its website says so.
ALTER TABLE "mobile_apps" ADD COLUMN "appStoreId" TEXT,
ADD COLUMN "onGooglePlay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "promoteOnWebsite" BOOLEAN NOT NULL DEFAULT true;

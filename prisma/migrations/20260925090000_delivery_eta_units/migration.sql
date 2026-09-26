-- Delivery times are no longer whole days. A rate, a pickup location and the
-- window copied onto an order now carry MINUTES plus the unit the merchant
-- entered, so "45 minutes" and "2 hours" are sayable alongside "3 working
-- days". Existing rows are days, so they convert at 1440 minutes a day.

CREATE TYPE "DeliveryEtaUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- delivery rates
ALTER TABLE "delivery_rates" ADD COLUMN "minMinutes" INTEGER;
ALTER TABLE "delivery_rates" ADD COLUMN "maxMinutes" INTEGER;
ALTER TABLE "delivery_rates" ADD COLUMN "etaUnit" "DeliveryEtaUnit" NOT NULL DEFAULT 'DAYS';
UPDATE "delivery_rates" SET "minMinutes" = "minDays" * 1440, "maxMinutes" = "maxDays" * 1440;
ALTER TABLE "delivery_rates" ALTER COLUMN "minMinutes" SET NOT NULL;
ALTER TABLE "delivery_rates" ALTER COLUMN "maxMinutes" SET NOT NULL;
ALTER TABLE "delivery_rates" DROP COLUMN "minDays";
ALTER TABLE "delivery_rates" DROP COLUMN "maxDays";

-- pickup locations
ALTER TABLE "pickup_locations" ADD COLUMN "readyMinutes" INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE "pickup_locations" ADD COLUMN "readyUnit" "DeliveryEtaUnit" NOT NULL DEFAULT 'DAYS';
UPDATE "pickup_locations" SET "readyMinutes" = "readyInDays" * 1440;
ALTER TABLE "pickup_locations" DROP COLUMN "readyInDays";

-- the window quoted onto an order
ALTER TABLE "orders" ADD COLUMN "deliveryEtaMinMinutes" INTEGER;
ALTER TABLE "orders" ADD COLUMN "deliveryEtaMaxMinutes" INTEGER;
ALTER TABLE "orders" ADD COLUMN "deliveryEtaUnit" "DeliveryEtaUnit";
UPDATE "orders"
   SET "deliveryEtaMinMinutes" = "deliveryEtaMinDays" * 1440,
       "deliveryEtaMaxMinutes" = "deliveryEtaMaxDays" * 1440,
       "deliveryEtaUnit" = 'DAYS'
 WHERE "deliveryEtaMinDays" IS NOT NULL;
ALTER TABLE "orders" DROP COLUMN "deliveryEtaMinDays";
ALTER TABLE "orders" DROP COLUMN "deliveryEtaMaxDays";

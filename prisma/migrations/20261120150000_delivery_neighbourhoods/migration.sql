-- Delivery by neighbourhood inside an LGA (ROADMAP 25.2).
ALTER TABLE "delivery_zones" ADD COLUMN "areas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "customer_addresses" ADD COLUMN "area" TEXT;
ALTER TABLE "orders" ADD COLUMN "shipArea" TEXT;

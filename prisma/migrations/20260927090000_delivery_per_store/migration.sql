-- Delivery belongs to the store a parcel leaves from (ROADMAP Phase 9.2).
--
-- Until now a delivery zone belonged to the whole business and was priced as
-- if every order left from one place. Now each zone and pickup location names
-- its store, and existing ones are handed out like this, per organization:
--
--   TARGET STORES = the open stores that sell online; if there are none, the
--   business's only store (when it has exactly one); otherwise nobody.
--
--   Zones: the first target store (oldest) keeps the originals, so option ids
--   quoted to a shopper mid-checkout still resolve. Every other target store
--   gets its own copy of every zone and rate. With more than one target store,
--   all of them are flagged `deliveryNeedsReview`: the prices were set with one
--   origin in mind, and Settings → Delivery asks the merchant to check each.
--
--   Pickups are a physical place, so they are never copied: one target store →
--   it; several → the store in the same city and state, if exactly one is;
--   otherwise left without a store for the merchant to choose.
--
--   Anything left without a store is kept (never deleted) but not offered at
--   checkout until someone picks its store.
--
-- Hand-written rather than `migrate dev`, which would also rewrite the
-- unrelated orders.customerId drift on the dev database (see Phase 8.6 notes).

-- AlterTable
ALTER TABLE "delivery_zones" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "pickup_locations" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "deliveryNeedsReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "delivery_zones_warehouseId_idx" ON "delivery_zones"("warehouseId");
CREATE INDEX "pickup_locations_warehouseId_idx" ON "pickup_locations"("warehouseId");

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand existing zones and pickups to stores.
DO $$
DECLARE
  org RECORD;
  zone RECORD;
  targets TEXT[];
  first_store TEXT;
  new_zone TEXT;
BEGIN
  FOR org IN
    SELECT "organizationId" AS id FROM "delivery_zones"
    UNION
    SELECT "organizationId" FROM "pickup_locations"
  LOOP
    SELECT array_agg("id" ORDER BY "createdAt", "id") INTO targets
    FROM "warehouses"
    WHERE "organizationId" = org.id AND "sellsOnline" AND "status" = 'ACTIVE';

    IF targets IS NULL THEN
      SELECT array_agg("id") INTO targets
      FROM "warehouses"
      WHERE "organizationId" = org.id
      HAVING count(*) = 1;
    END IF;

    CONTINUE WHEN targets IS NULL;
    first_store := targets[1];

    UPDATE "delivery_zones" SET "warehouseId" = first_store
    WHERE "organizationId" = org.id AND "warehouseId" IS NULL;

    FOR i IN 2..coalesce(array_length(targets, 1), 1) LOOP
      FOR zone IN
        SELECT * FROM "delivery_zones" WHERE "organizationId" = org.id AND "warehouseId" = first_store
      LOOP
        new_zone := 'c' || replace(gen_random_uuid()::text, '-', '');
        INSERT INTO "delivery_zones"
          ("id", "organizationId", "warehouseId", "name", "kind", "state", "states", "cities", "isActive", "sortOrder", "createdAt", "updatedAt")
        VALUES
          (new_zone, zone."organizationId", targets[i], zone."name", zone."kind", zone."state", zone."states", zone."cities",
           zone."isActive", zone."sortOrder", zone."createdAt", NOW());

        INSERT INTO "delivery_rates"
          ("id", "organizationId", "zoneId", "name", "price", "minMinutes", "maxMinutes", "etaUnit", "freeOver", "isActive", "sortOrder", "createdAt", "updatedAt")
        SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), r."organizationId", new_zone, r."name", r."price",
               r."minMinutes", r."maxMinutes", r."etaUnit", r."freeOver", r."isActive", r."sortOrder", r."createdAt", NOW()
        FROM "delivery_rates" r
        WHERE r."zoneId" = zone.id;
      END LOOP;
    END LOOP;

    IF array_length(targets, 1) > 1 AND EXISTS (SELECT 1 FROM "delivery_zones" WHERE "organizationId" = org.id) THEN
      UPDATE "warehouses" SET "deliveryNeedsReview" = true WHERE "id" = ANY(targets);
    END IF;

    IF array_length(targets, 1) = 1 THEN
      UPDATE "pickup_locations" SET "warehouseId" = first_store
      WHERE "organizationId" = org.id AND "warehouseId" IS NULL;
    ELSE
      UPDATE "pickup_locations" p SET "warehouseId" = (
        SELECT w."id" FROM "warehouses" w
        WHERE w."id" = ANY(targets)
          AND lower(trim(w."state")) = lower(trim(p."state"))
          AND lower(trim(w."city")) = lower(trim(p."city"))
      )
      WHERE p."organizationId" = org.id
        AND p."warehouseId" IS NULL
        AND (
          SELECT count(*) FROM "warehouses" w
          WHERE w."id" = ANY(targets)
            AND lower(trim(w."state")) = lower(trim(p."state"))
            AND lower(trim(w."city")) = lower(trim(p."city"))
        ) = 1;
    END IF;
  END LOOP;
END $$;

-- Where a store is (ROADMAP Phase 9.1): a Nigerian state and a city, so
-- delivery can later be priced from the store a parcel leaves.
--
-- Nullable: existing stores keep working, and one that already sells online is
-- NOT switched off — the admin asks for its place instead. A store needs both
-- before it can START selling online (features/inventory/warehouses.ts).
--
-- Hand-written rather than `migrate dev`, which would also rewrite the
-- unrelated orders.customerId drift on the dev database (see Phase 8.6 notes).

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN "state" TEXT,
ADD COLUMN "city" TEXT;

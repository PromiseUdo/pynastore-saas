-- Payment terms per product: true = must be paid for before delivery, so
-- pay-on-delivery is not offered for any order containing it.
ALTER TABLE "inventory_items" ADD COLUMN "requiresPrepayment" BOOLEAN NOT NULL DEFAULT false;

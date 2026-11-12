-- Checkout rules each merchant chooses (Settings → Payments): pay on delivery,
-- ordering without an account, and order notes. All on, as every shop worked before.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "checkoutGuestAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "checkoutOrderNotes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "checkoutPayOnDelivery" BOOLEAN NOT NULL DEFAULT true;

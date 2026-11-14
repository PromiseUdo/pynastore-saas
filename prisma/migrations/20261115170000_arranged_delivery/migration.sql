-- Wholesale: "delivery to be arranged" for big trade orders (ROADMAP 21.4B).

-- AlterEnum
ALTER TYPE "OrderPaymentStatus" ADD VALUE 'AWAITING_DELIVERY_PRICE';

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "arrangedDeliveryFromItems" INTEGER,
ADD COLUMN     "arrangedDeliveryFromValue" DECIMAL(12,2),
ADD COLUMN     "arrangedDeliveryOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "arrangedPriceHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryAcceptBy" TIMESTAMP(3),
ADD COLUMN     "deliveryAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryArranged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryArrangedNote" TEXT,
ADD COLUMN     "deliveryPriceDueAt" TIMESTAMP(3),
ADD COLUMN     "deliveryPriceRemindedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryPricedAt" TIMESTAMP(3);


-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "packingAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3);


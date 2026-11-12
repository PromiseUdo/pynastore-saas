-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "vatNumber" TEXT;
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "vatNumber" TEXT,
ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 7.5,
ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false;

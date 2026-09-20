-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "confirmationToken" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "orders_confirmationToken_key" ON "orders"("confirmationToken");


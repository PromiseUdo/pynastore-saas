-- CreateTable
CREATE TABLE "customer_wishlist_items" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_wishlist_items_customerId_idx" ON "customer_wishlist_items"("customerId");

-- CreateIndex
CREATE INDEX "customer_wishlist_items_productId_idx" ON "customer_wishlist_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_wishlist_items_customerId_productId_key" ON "customer_wishlist_items"("customerId", "productId");

-- AddForeignKey
ALTER TABLE "customer_wishlist_items" ADD CONSTRAINT "customer_wishlist_items_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wishlist_items" ADD CONSTRAINT "customer_wishlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


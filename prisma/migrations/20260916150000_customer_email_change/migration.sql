-- CreateTable
CREATE TABLE "customer_email_changes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_email_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_email_changes_tokenHash_key" ON "customer_email_changes"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_email_changes_customerId_idx" ON "customer_email_changes"("customerId");

-- CreateIndex
CREATE INDEX "customer_email_changes_expiresAt_idx" ON "customer_email_changes"("expiresAt");

-- AddForeignKey
ALTER TABLE "customer_email_changes" ADD CONSTRAINT "customer_email_changes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


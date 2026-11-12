-- Shoppers prove their email with a six-digit code (ROADMAP 20.1).

-- CreateTable
CREATE TABLE "customer_email_verifications" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_email_verifications_tokenHash_key" ON "customer_email_verifications"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_email_verifications_customerId_idx" ON "customer_email_verifications"("customerId");

-- CreateIndex
CREATE INDEX "customer_email_verifications_expiresAt_idx" ON "customer_email_verifications"("expiresAt");

-- AddForeignKey
ALTER TABLE "customer_email_verifications" ADD CONSTRAINT "customer_email_verifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

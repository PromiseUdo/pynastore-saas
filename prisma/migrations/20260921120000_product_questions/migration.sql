-- CreateEnum
CREATE TYPE "ProductQuestionStatus" AS ENUM ('PENDING', 'ANSWERED', 'HIDDEN');

-- CreateTable
CREATE TABLE "product_questions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ProductQuestionStatus" NOT NULL DEFAULT 'PENDING',
    "answerBody" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answeredByUserId" TEXT,
    "hiddenReason" TEXT,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_questions_organizationId_status_createdAt_idx" ON "product_questions"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "product_questions_productId_status_idx" ON "product_questions"("productId", "status");

-- CreateIndex
CREATE INDEX "product_questions_customerId_idx" ON "product_questions"("customerId");

-- CreateIndex
CREATE INDEX "product_questions_answeredByUserId_idx" ON "product_questions"("answeredByUserId");

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

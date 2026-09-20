-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "invoice_line_items" ADD COLUMN     "returnedQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "unitCost" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "notes" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_line_items" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "invoiceLineItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "return_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_requests_organizationId_idx" ON "return_requests"("organizationId");

-- CreateIndex
CREATE INDEX "return_requests_invoiceId_idx" ON "return_requests"("invoiceId");

-- CreateIndex
CREATE INDEX "return_line_items_returnRequestId_idx" ON "return_line_items"("returnRequestId");

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_line_items" ADD CONSTRAINT "return_line_items_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_line_items" ADD CONSTRAINT "return_line_items_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "invoice_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

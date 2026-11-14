-- Wholesale: the buyer's business on a trade order, for its business invoice (ROADMAP 21.6).

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "buyerBusinessName" TEXT,
ADD COLUMN     "buyerCacNumber" TEXT,
ADD COLUMN     "buyerTaxId" TEXT;


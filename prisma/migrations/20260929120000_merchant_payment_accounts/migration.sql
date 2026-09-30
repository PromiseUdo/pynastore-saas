-- ROADMAP 10.2: how a shop gets paid online (business details, settlement
-- account, our verification) and its private verification documents.
--
-- Hand-trimmed from `prisma migrate diff`: the generated diff also re-creates
-- orders_customerId_fkey (the known dev-database drift, see ROADMAP 8.6), which
-- has nothing to do with this change and is deliberately left out.
-- Additive only: two tables, five enums, no existing row touched.

-- CreateEnum
CREATE TYPE "MerchantBusinessType" AS ENUM ('COMPANY', 'BUSINESS_NAME', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "MerchantIdType" AS ENUM ('NIN', 'INTERNATIONAL_PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD');

-- CreateEnum
CREATE TYPE "MerchantDocumentKind" AS ENUM ('CAC_CERTIFICATE', 'ID_DOCUMENT', 'PROOF_OF_ADDRESS');

-- CreateEnum
CREATE TYPE "MerchantVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MerchantPaymentSetupStatus" AS ENUM ('NOT_STARTED', 'AWAITING_VERIFICATION', 'CREATING', 'ACTIVE', 'ACTION_REQUIRED', 'DISABLED');

-- CreateTable
CREATE TABLE "merchant_payment_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessType" "MerchantBusinessType",
    "businessName" TEXT,
    "cacNumber" TEXT,
    "registeredName" TEXT,
    "idType" "MerchantIdType",
    "settlementBankCode" TEXT,
    "settlementBankName" TEXT,
    "settlementAccountNumber" TEXT,
    "settlementAccountName" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "verificationStatus" "MerchantVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "setupStatus" "MerchantPaymentSetupStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "paystackSubaccountCode" TEXT,
    "setupError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_verification_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "MerchantDocumentKind" NOT NULL,
    "publicId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payment_accounts_organizationId_key" ON "merchant_payment_accounts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payment_accounts_paystackSubaccountCode_key" ON "merchant_payment_accounts"("paystackSubaccountCode");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_verification_documents_publicId_key" ON "merchant_verification_documents"("publicId");

-- CreateIndex
CREATE INDEX "merchant_verification_documents_accountId_idx" ON "merchant_verification_documents"("accountId");

-- CreateIndex
CREATE INDEX "merchant_verification_documents_organizationId_idx" ON "merchant_verification_documents"("organizationId");

-- AddForeignKey
ALTER TABLE "merchant_payment_accounts" ADD CONSTRAINT "merchant_payment_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_verification_documents" ADD CONSTRAINT "merchant_verification_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_verification_documents" ADD CONSTRAINT "merchant_verification_documents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "merchant_payment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

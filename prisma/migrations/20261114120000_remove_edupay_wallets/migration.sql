-- EduPay wallets removed (ROADMAP Phase 20, 2026-11-14).
-- These tables held only OUR links to wallets at EduPay; no money lived here.
-- Older orders keep paymentMethod 'wallet' and attempts with provider 'edupay' as history.

-- DropForeignKey
ALTER TABLE "shopper_wallets" DROP CONSTRAINT "shopper_wallets_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "shopper_wallets" DROP CONSTRAINT "shopper_wallets_customerId_fkey";

-- DropForeignKey
ALTER TABLE "shop_wallets" DROP CONSTRAINT "shop_wallets_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wallet_top_ups" DROP CONSTRAINT "wallet_top_ups_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wallet_top_ups" DROP CONSTRAINT "wallet_top_ups_customerId_fkey";

-- DropForeignKey
ALTER TABLE "wallet_refunds" DROP CONSTRAINT "wallet_refunds_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wallet_refunds" DROP CONSTRAINT "wallet_refunds_orderId_fkey";

-- DropForeignKey
ALTER TABLE "wallet_withdrawals" DROP CONSTRAINT "wallet_withdrawals_organizationId_fkey";

-- DropTable
DROP TABLE "shopper_wallets";

-- DropTable
DROP TABLE "shop_wallets";

-- DropTable
DROP TABLE "wallet_top_ups";

-- DropTable
DROP TABLE "wallet_refunds";

-- DropTable
DROP TABLE "wallet_withdrawals";

-- DropEnum
DROP TYPE "WalletStatus";

-- DropEnum
DROP TYPE "WalletOrigin";

-- DropEnum
DROP TYPE "WalletKind";

-- DropEnum
DROP TYPE "WalletTopUpStatus";

-- DropEnum
DROP TYPE "WalletRefundStatus";

-- DropEnum
DROP TYPE "WalletWithdrawalStatus";


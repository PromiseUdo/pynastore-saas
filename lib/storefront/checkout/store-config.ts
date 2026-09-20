/*
 * lib/storefront/checkout/store-config.ts
 *
 * The checkout configuration for a real store. Server only.
 *
 * ./config.ts holds everything that is the same for every store and is safe
 * to import into client components (the find* lookups live there). What
 * depends on the merchant's own records is added here — today, bank transfer,
 * which is offered only while the merchant has an active bank account
 * (Settings → Payments), listed last.
 *
 * Use this, not getCheckoutConfig, anywhere payment methods matter: the
 * checkout page, the confirmation page, and placing the order — so a shopper
 * can't choose a method the server then refuses, or the reverse.
 */
import { prisma } from '@/lib/prisma';
import type { StoreScope } from '../types';
import { BANK_TRANSFER_METHOD } from '../mock/checkout';
import { getCheckoutConfig } from './config';
import { useFixtures } from '../data/current';
import { storeHasDelivery } from '../delivery/quote';
import type { CheckoutConfig, TransferAccount } from './types';

export async function activeTransferAccounts(organizationSlug: string): Promise<TransferAccount[]> {
  return prisma.merchantBankAccount.findMany({
    where: { isActive: true, organization: { slug: organizationSlug, status: 'ACTIVE' } },
    select: { bankName: true, accountName: true, accountNumber: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getStoreCheckoutConfig(scope: StoreScope): Promise<CheckoutConfig> {
  const [base, transferAccounts, hasDelivery] = await Promise.all([
    getCheckoutConfig(scope),
    activeTransferAccounts(scope.organizationSlug),
    storeHasDelivery(scope.organizationSlug),
  ]);

  /* Under the demo fixtures the store keeps the fixed demo delivery list, so a
   * catalogue demo checks out without zones. Everything else is the store's. */
  const delivery = useFixtures()
    ? {}
    : {
        /* Delivery options depend on the address, so none are listed up front:
         * checkout asks for a quote once it has one (quoteDeliveryAction). */
        deliveryMethods: [],
        defaultDeliveryMethodId: '',
        deliveryAvailable: hasDelivery,
      };

  return {
    ...base,
    ...delivery,
    paymentMethods: transferAccounts.length ? [...base.paymentMethods, BANK_TRANSFER_METHOD] : base.paymentMethods,
    transferAccounts,
  };
}

/*
 * lib/storefront/checkout/store-config.ts
 *
 * The checkout configuration for a real store. Server only.
 *
 * ./config.ts holds everything that is the same for every store and is safe
 * to import into client components (the find* lookups live there). What
 * depends on the merchant's own records is added here:
 *   - "Pay online" (Paystack), listed first, only while the shop may take
 *     online payments — verified by us, subaccount active, not suspended
 *     (onlinePaymentReadiness, ROADMAP 10.8);
 *   - pay on delivery, unless the merchant turned it off;
 *   - bank transfer, listed last, only while the merchant has an active bank
 *     account (Settings → Payments);
 *   - whether shoppers may order without an account, and leave a note — the
 *     merchant's checkout rules (Settings → Payments → Checkout);
 *   - the shop's VAT, only when it is VAT registered (Settings → General,
 *     ROADMAP 14.1);
 *   - for an approved trade buyer (pass `tradeBuyer`), only the ways the
 *     merchant lets trade orders be paid (Settings → Wholesale, ROADMAP
 *     21.1) — narrowing the list above, never adding to it.
 *
 * Use this, not getCheckoutConfig, anywhere payment methods matter: the
 * checkout page, the confirmation page, and placing the order — so a shopper
 * can't choose a method the server then refuses, or the reverse.
 */
import { prisma } from '@/lib/prisma';
import type { StoreScope } from '../types';
import { BANK_TRANSFER_METHOD, ONLINE_PAYMENT_METHOD, PAY_ON_DELIVERY_METHOD } from './payment-methods';
import { onlinePaymentReadiness } from '@/lib/payments/payment-setup';
import { getCheckoutConfig } from './config';
import { getWholesaleSettingsBySlug } from '@/lib/trade/accounts';
import { tradeMayPayWith } from '@/lib/trade/rules';
import { shopVatBySlug } from '@/lib/tax-settings';
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

/** The one readiness rule, looked up by the store's slug. */
export async function onlinePaymentsReady(organizationSlug: string): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { status: true, paymentAccount: { select: { verificationStatus: true, setupStatus: true } } },
  });
  if (!organization) return false;
  return onlinePaymentReadiness({ account: organization.paymentAccount, organizationStatus: organization.status }).ready;
}

export interface CheckoutRules {
  payOnDelivery: boolean;
  guestAllowed: boolean;
  orderNotes: boolean;
}

/** The merchant's checkout rules. A store with no record (the demo fixtures)
 *  keeps the defaults, which are every shop's until its merchant changes them. */
export async function storeCheckoutRules(organizationSlug: string): Promise<CheckoutRules> {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { checkoutPayOnDelivery: true, checkoutGuestAllowed: true, checkoutOrderNotes: true },
  });
  return {
    payOnDelivery: organization?.checkoutPayOnDelivery ?? true,
    guestAllowed: organization?.checkoutGuestAllowed ?? true,
    orderNotes: organization?.checkoutOrderNotes ?? true,
  };
}

export async function getStoreCheckoutConfig(
  scope: StoreScope,
  /** the signed-in shopper is an approved trade buyer here (lib/trade/accounts.ts isTradeBuyer) */
  { tradeBuyer = false }: { tradeBuyer?: boolean } = {},
): Promise<CheckoutConfig> {
  const [base, transferAccounts, hasDelivery, onlineReady, rules, vat, wholesale] = await Promise.all([
    getCheckoutConfig(scope),
    activeTransferAccounts(scope.organizationSlug),
    storeHasDelivery(scope.organizationSlug, tradeBuyer ? 'trade' : 'retail'),
    onlinePaymentsReady(scope.organizationSlug),
    storeCheckoutRules(scope.organizationSlug),
    shopVatBySlug(scope.organizationSlug),
    tradeBuyer ? getWholesaleSettingsBySlug(scope.organizationSlug) : null,
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
    paymentMethods: [
      ...(onlineReady ? [ONLINE_PAYMENT_METHOD] : []),
      ...base.paymentMethods.filter((method) => rules.payOnDelivery || method.id !== PAY_ON_DELIVERY_METHOD.id),
      ...(transferAccounts.length ? [BANK_TRANSFER_METHOD] : []),
    ].filter((method) => !wholesale || tradeMayPayWith(method.id, wholesale)),
    transferAccounts,
    // A trade buyer at a shop that quotes wholesale before VAT has it added to those lines (21.2).
    vat: vat && wholesale?.vatAdded ? { ...vat, addedToWholesale: true } : vat,
    // A trade buyer's order must reach the shop's minimum (21.3). Admin money is major units.
    ...(wholesale?.minOrderValue ? { tradeMinOrderValue: Math.round(wholesale.minOrderValue * 100) } : {}),
    // Checkout asks for the business an invoice is made out to (21.6).
    ...(wholesale ? { tradeBuyer: true } : {}),
    guestCheckoutEnabled: base.guestCheckoutEnabled && rules.guestAllowed,
    orderNotesEnabled: base.orderNotesEnabled && rules.orderNotes,
  };
}

/*
 * /checkout
 *
 * A Server Component that resolves the TENANT'S checkout configuration and
 * hands it to the client flow. That split is the point of the page:
 *
 *   - currency, delivery options, payment options, tax and guest rules are
 *     resolved on the server, per store (lib/storefront/checkout/config.ts).
 *     Today they come from fixtures; tomorrow from that tenant's row, and
 *     this file is the only place that changes.
 *   - the flow itself is a Client Component because the bag lives in the
 *     browser and a form is interaction — but only the flow is, not the page.
 *
 * The shopper's ACCOUNT is resolved here too, for the same reason: the
 * session cookie and the address book are server facts. A guest gets null
 * and the flow is identical — an account only ever saves typing here, it is
 * never a condition of ordering.
 *
 * The empty-bag case is handled INSIDE the client view rather than by a
 * server redirect: the server cannot see a browser-held cart, so any
 * server-side decision here would be a guess. See <CheckoutView />.
 *
 * NOT INDEXED. A checkout is one shopper's session, it is behind a bag that
 * only they have, and it must never appear in search results — so `robots`
 * says so explicitly, the same way /cart does.
 */
import type { Metadata } from 'next';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { isTradeBuyer } from '@/lib/trade/accounts';
import { tradeBusinessOnFile } from '@/lib/trade/business';
import { getShopper } from '@/lib/storefront/account/session';
import { listAddresses } from '@/lib/storefront/account/addresses';
import type { CheckoutAccount } from '@/lib/storefront/checkout/types';
import { CheckoutView } from '@/components/storefront/checkout/checkout-view';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  /* The tenant seam: this store's checkout, not "the" checkout. */
  const shopper = await getShopper();
  // A trade buyer sees only the ways the merchant lets trade orders be paid (ROADMAP 21.1).
  const tradeBuyer = shopper ? await isTradeBuyer(shopper.organizationId, shopper.id) : false;
  const config = await getStoreCheckoutConfig({ organizationSlug }, { tradeBuyer, customerId: shopper?.id ?? null });

  let account: CheckoutAccount | null = null;
  if (shopper) {
    const [firstName = '', ...rest] = shopper.name.trim().split(/\s+/);
    // The business their invoice is made out to, from their trade account (ROADMAP 21.6).
    const business = tradeBuyer ? await tradeBusinessOnFile(shopper.organizationId, shopper.id) : null;
    account = {
      contact: {
        firstName,
        lastName: rest.join(' '),
        email: shopper.email,
        phone: shopper.phone ?? '',
      },
      addresses: await listAddresses({
        organizationId: shopper.organizationId,
        customerId: shopper.id,
      }),
      ...(business ? { business } : {}),
    };
  }

  return (
    <>
      <h1 className="sr-only">Checkout</h1>
      <CheckoutView config={config} account={account} />
    </>
  );
}

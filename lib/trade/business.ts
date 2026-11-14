/*
 * lib/trade/business.ts
 *
 * The business a trade order is made out to (ROADMAP 21.6). Server only.
 *
 * A trade buyer's business name and tax ID are on file already — the name
 * on their trade account, the tax ID on the customer (one place for it, as
 * invoices read it). Checkout fills them in from there; the buyer may change
 * them for this order (a branch, a sister company), and what they confirm is
 * copied onto the ORDER, so the invoice says what was agreed when it was
 * placed, whatever the account says later.
 *
 * Only an APPROVED trade account counts, checked again here at the moment of
 * ordering. A shopper who isn't one gets no business on their order, whatever
 * the browser sent.
 */
import { prisma } from '@/lib/prisma';
import type { CheckoutBusiness } from '@/lib/storefront/checkout/types';

export interface OrderBusiness {
  name: string;
  taxId: string | null;
  cacNumber: string | null;
}

/** What checkout fills in for an approved trade buyer; null for anyone else. */
export async function tradeBusinessOnFile(organizationId: string, customerId: string): Promise<CheckoutBusiness | null> {
  const account = await prisma.tradeAccount.findFirst({
    where: { organizationId, customerId, status: 'APPROVED' },
    select: { businessName: true, customer: { select: { taxId: true } } },
  });
  if (!account) return null;
  return { name: account.businessName, taxId: account.customer.taxId ?? '' };
}

const clean = (value: string | null | undefined, max: number) => {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return trimmed || null;
};

/**
 * The business to copy onto a new order: what the buyer typed, falling back
 * to what's on file for anything left blank. Null when they aren't an
 * approved trade buyer here.
 *
 * `rememberTaxId` is true when they gave a tax ID and the store had none
 * for them — the caller saves it after the order commits, so next time
 * checkout fills it in. A tax ID already on file is never overwritten from
 * checkout; that's for the buyer's account page or the merchant.
 */
export async function orderBusinessFor(
  organizationId: string,
  customerId: string,
  typed: CheckoutBusiness | null | undefined,
): Promise<{ business: OrderBusiness; rememberTaxId: boolean } | null> {
  const account = await prisma.tradeAccount.findFirst({
    where: { organizationId, customerId, status: 'APPROVED' },
    select: { businessName: true, cacNumber: true, customer: { select: { taxId: true } } },
  });
  if (!account) return null;

  const onFileTaxId = clean(account.customer.taxId, 60);
  const typedTaxId = clean(typed?.taxId, 60);
  return {
    business: {
      name: clean(typed?.name, 150) ?? account.businessName,
      taxId: typedTaxId ?? onFileTaxId,
      cacNumber: clean(account.cacNumber, 40),
    },
    rememberTaxId: Boolean(typedTaxId) && !onFileTaxId,
  };
}

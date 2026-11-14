/*
 * /order-invoice/[token] — the business invoice for a trade order (ROADMAP 21.6).
 *
 * Linked from the buyer's order page, their confirmation page and the order
 * emails. Outside the (shop) group like the merchant's invoice page
 * (../../invoice/[token]): a document to print or save, not a page to shop
 * from.
 *
 * The token is the order's confirmation token — the same key as its
 * confirmation page — matched together with the store, so one store's link
 * is a miss under another's domain. A wrong token and an order that isn't a
 * trade order answer the same way.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { tradeInvoiceByToken } from '@/lib/storefront/orders/trade-invoice';
import { TradeInvoiceDocument } from '@/components/sales/trade-invoice-document';

/* A bill is nobody's business but the buyer's. */
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } };

export default async function TradeOrderInvoicePage({
  params,
}: {
  params: Promise<{ organizationSlug: string; token: string }>;
}) {
  const { organizationSlug, token } = await params;

  const store = await findStoreBySlug(organizationSlug);
  if (!store) notFound();

  const invoice = await tradeInvoiceByToken(store.id, decodeURIComponent(token));
  if (!invoice) notFound();

  return <TradeInvoiceDocument invoice={invoice} />;
}

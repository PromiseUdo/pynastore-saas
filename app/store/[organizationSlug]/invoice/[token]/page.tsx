/*
 * The customer's copy of an invoice.
 *
 * Deliberately outside the (shop) group: someone opening a bill is not
 * shopping, and a mega-menu, a bag and a newsletter sign-up around it would
 * be noise around a document. It is one column, printable, and says only
 * what the merchant recorded.
 *
 * The token in the URL is the only key (lib/storefront/invoices/read.ts).
 * A wrong one, a voided invoice and a draft all answer the same way, so the
 * page can't be used to find out which invoices exist.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { getInvoiceByToken } from '@/lib/storefront/invoices/read';
import { InvoiceDocument } from './_components/InvoiceDocument';

/* A bill is nobody's business but the customer's. */
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } };

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ organizationSlug: string; token: string }>;
}) {
  const { organizationSlug, token } = await params;

  const store = await findStoreBySlug(organizationSlug);
  if (!store) notFound();

  /* Matched together with the store: a token from one merchant is a miss
   * under another's domain, never a leak. */
  const invoice = await getInvoiceByToken(store.id, token);
  if (!invoice) notFound();

  return <InvoiceDocument invoice={invoice} />;
}

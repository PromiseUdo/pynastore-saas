/*
 * The title of a printable admin page — receipt, packing slip, business
 * invoice — which is also the file name when it's saved as a PDF
 * ("AurafumeNG receipt ORD-2026-000001.pdf").
 *
 * So it names the shop and the record, and NOT the platform: the root
 * layout's "… · Pynastore" template is skipped (`absolute`). The merchant
 * is filing their own paperwork, and their customer may get the file.
 *
 * Reads only the record's number, with the shop's id beside the record's,
 * so another shop's id finds nothing and the title falls back to the plain
 * kind of document.
 */
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';

type Printable = { kind: 'receipt' | 'packing slip' | 'invoice'; orderId: string } | { kind: 'receipt'; invoiceId: string };

export async function printableTitle(doc: Printable): Promise<Metadata> {
  const ctx = await getOrganizationContext();
  const organizationId = ctx.organization.id;
  const number =
    'invoiceId' in doc
      ? (await prisma.invoice.findFirst({ where: { id: doc.invoiceId, organizationId }, select: { invoiceNumber: true } }))
          ?.invoiceNumber
      : (await prisma.order.findFirst({ where: { id: doc.orderId, organizationId }, select: { reference: true } }))
          ?.reference;
  return { title: { absolute: [ctx.organization.name, doc.kind, number].filter(Boolean).join(' ') } };
}

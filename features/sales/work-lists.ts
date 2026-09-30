'use server';

/*
 * features/sales/work-lists.ts
 *
 * Sales → Fulfillment and Sales → Returns as ONE list each (ROADMAP 12.4).
 * A shop sends and takes back goods two ways, and both stay:
 *   - orders (the online shop and the counter): parcels are sent from the
 *     order page (Phase 9.6), returns are answered on the order (10.7);
 *   - invoices (wholesale / business-to-business): an invoice is picked,
 *     packed and shipped as a Fulfillment, and returns are raised against it.
 * These lists put both side by side, each row marked where it came from and
 * opening the one place it's handled — so "what do I need to send?" has one
 * answer, whichever way the shop sells.
 *
 * Both sources are read with the same filters, merged by date, then paged.
 * Each source is capped at what the requested page can need, so a page costs
 * two bounded queries whatever the totals.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { isReturnReason, RETURN_REASONS } from '@/lib/storefront/orders/policy';
import { type ActionResult, toActionError } from './shared';

export type WorkSource = 'order' | 'invoice';
export type SourceFilter = 'all' | WorkSource;

const PAGE_SIZE = 25;

/* ─── To send ───────────────────────────────────────────────────────────── */

export type ToSendFilter = 'open' | 'done' | 'all';

export interface ToSendRow {
  key: string;
  source: WorkSource;
  href: string;
  reference: string;
  customerName: string;
  storeName: string | null;
  /** "Delivery", "Pickup" or "Invoice dispatch" */
  kindLabel: string;
  itemCount: number;
  status: string;
  statusLabel: string;
  statusVariant: 'draft' | 'pending' | 'approved' | 'processing' | 'completed' | 'cancelled';
  /** when it became something to send */
  since: string;
  /** an online order to be paid for on delivery */
  payOnDelivery: boolean;
}

export interface ToSendPage {
  rows: ToSendRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { open: number; openOrders: number; openInvoices: number };
}

const FULFILLMENT_STATUS: Record<string, { label: string; variant: ToSendRow['statusVariant'] }> = {
  PENDING: { label: 'To pick', variant: 'draft' },
  PARTIALLY_PICKED: { label: 'Picking', variant: 'pending' },
  PICKED: { label: 'To pack', variant: 'pending' },
  PARTIALLY_PACKED: { label: 'Packing', variant: 'processing' },
  PACKED: { label: 'Ready to ship', variant: 'approved' },
  SHIPPED: { label: 'Shipped', variant: 'completed' },
  CANCELLED: { label: 'Cancelled', variant: 'cancelled' },
};

/** A parcel the order page lets you send now: the same rule sendShipment enforces. */
const READY_ORDER = {
  status: { in: ['CONFIRMED', 'PROCESSING'] as ('CONFIRMED' | 'PROCESSING')[] },
  paymentStatus: { in: ['PAID', 'DUE_ON_DELIVERY'] as ('PAID' | 'DUE_ON_DELIVERY')[] },
};

function shipmentWhere(organizationId: string, filter: ToSendFilter, q: string) {
  const search = q
    ? {
        OR: [
          { reference: { contains: q, mode: 'insensitive' as const } },
          { firstName: { contains: q, mode: 'insensitive' as const } },
          { lastName: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};
  if (filter === 'open') return { organizationId, status: 'PENDING' as const, order: { ...READY_ORDER, ...search } };
  if (filter === 'done') return { organizationId, status: { in: ['DISPATCHED', 'DELIVERED'] as ('DISPATCHED' | 'DELIVERED')[] }, order: search };
  return { organizationId, status: { not: 'CANCELLED' as const }, order: search };
}

function fulfillmentWhere(organizationId: string, filter: ToSendFilter, q: string) {
  const search = q
    ? {
        invoice: {
          OR: [
            { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
            { customer: { name: { contains: q, mode: 'insensitive' as const } } },
          ],
        },
      }
    : {};
  const status =
    filter === 'open'
      ? { notIn: ['SHIPPED', 'CANCELLED'] as ('SHIPPED' | 'CANCELLED')[] }
      : filter === 'done'
        ? { equals: 'SHIPPED' as const }
        : { not: 'CANCELLED' as const };
  return { organizationId, status, ...search };
}

export async function listToSend(params: {
  filter?: ToSendFilter;
  source?: SourceFilter;
  q?: string;
  page?: number;
}): Promise<ActionResult<ToSendPage>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;
    const filter = params.filter ?? 'open';
    const source = params.source ?? 'all';
    const q = params.q?.trim().slice(0, 80) ?? '';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const need = page * PAGE_SIZE;
    const oldestFirst = filter === 'open';

    const [shipments, fulfillments, shipmentCount, fulfillmentCount, openOrders, openInvoices] = await Promise.all([
      source === 'invoice'
        ? []
        : prisma.orderShipment.findMany({
            where: shipmentWhere(organizationId, filter, q),
            orderBy: { createdAt: oldestFirst ? 'asc' : 'desc' },
            take: need,
            select: {
              id: true,
              kind: true,
              status: true,
              createdAt: true,
              dispatchedAt: true,
              warehouse: { select: { name: true } },
              allocations: { select: { quantity: true } },
              order: {
                select: { id: true, reference: true, firstName: true, lastName: true, email: true, paymentStatus: true, confirmedAt: true, placedAt: true },
              },
            },
          }),
      source === 'order'
        ? []
        : prisma.fulfillment.findMany({
            where: fulfillmentWhere(organizationId, filter, q),
            orderBy: { createdAt: oldestFirst ? 'asc' : 'desc' },
            take: need,
            select: {
              id: true,
              status: true,
              createdAt: true,
              shippedAt: true,
              warehouse: { select: { name: true } },
              invoice: { select: { invoiceNumber: true, customer: { select: { name: true } } } },
              lineItems: { select: { quantity: true } },
            },
          }),
      source === 'invoice' ? 0 : prisma.orderShipment.count({ where: shipmentWhere(organizationId, filter, q) }),
      source === 'order' ? 0 : prisma.fulfillment.count({ where: fulfillmentWhere(organizationId, filter, q) }),
      prisma.orderShipment.count({ where: shipmentWhere(organizationId, 'open', '') }),
      prisma.fulfillment.count({ where: fulfillmentWhere(organizationId, 'open', '') }),
    ]);

    const rows: ToSendRow[] = [
      ...shipments.map((s): ToSendRow => {
        const pickup = s.kind === 'PICKUP';
        const status =
          s.status === 'PENDING'
            ? { label: pickup ? 'To hand over' : 'To send', variant: 'pending' as const }
            : s.status === 'DISPATCHED'
              ? { label: pickup ? 'Ready for pickup' : 'Sent', variant: 'processing' as const }
              : { label: pickup ? 'Collected' : 'Delivered', variant: 'completed' as const };
        const name = `${s.order.firstName ?? ''} ${s.order.lastName ?? ''}`.trim();
        return {
          key: `order:${s.id}`,
          source: 'order',
          href: `/sales/orders/${s.order.id}`,
          reference: s.order.reference,
          customerName: name || s.order.email || 'A customer',
          storeName: s.warehouse?.name ?? null,
          kindLabel: pickup ? 'Pickup' : 'Delivery',
          itemCount: s.allocations.reduce((n, a) => n + Number(a.quantity), 0),
          status: s.status,
          statusLabel: status.label,
          statusVariant: status.variant,
          since: (s.status === 'PENDING' ? (s.order.confirmedAt ?? s.order.placedAt) : (s.dispatchedAt ?? s.createdAt)).toISOString(),
          payOnDelivery: s.order.paymentStatus === 'DUE_ON_DELIVERY',
        };
      }),
      ...fulfillments.map((f): ToSendRow => {
        const status = FULFILLMENT_STATUS[f.status] ?? { label: 'In progress', variant: 'pending' as const };
        return {
          key: `invoice:${f.id}`,
          source: 'invoice',
          href: `/sales/fulfillment/${f.id}`,
          reference: f.invoice.invoiceNumber,
          customerName: f.invoice.customer.name,
          storeName: f.warehouse.name,
          kindLabel: 'Invoice dispatch',
          itemCount: f.lineItems.reduce((n, l) => n + Number(l.quantity), 0),
          status: f.status,
          statusLabel: status.label,
          statusVariant: status.variant,
          since: (f.status === 'SHIPPED' ? (f.shippedAt ?? f.createdAt) : f.createdAt).toISOString(),
          payOnDelivery: false,
        };
      }),
    ];
    rows.sort((a, b) => (oldestFirst ? a.since.localeCompare(b.since) : b.since.localeCompare(a.since)));

    return {
      success: true,
      data: {
        rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        total: shipmentCount + fulfillmentCount,
        page,
        pageSize: PAGE_SIZE,
        counts: { open: openOrders + openInvoices, openOrders, openInvoices },
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load what’s to send');
  }
}

/* ─── Returns ───────────────────────────────────────────────────────────── */

export type ReturnsFilter = 'open' | 'all';

export interface ReturnRow {
  key: string;
  source: WorkSource;
  href: string;
  reference: string;
  customerName: string;
  status: string;
  statusLabel: string;
  statusVariant: 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';
  /** the customer's reason, for an online-store return */
  reason: string | null;
  itemCount: number;
  requestedAt: string;
  /** refunded against it so far (online returns), if any */
  refunded: number | null;
  currency: string;
}

export interface ReturnsPage {
  rows: ReturnRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { open: number };
}

const ORDER_RETURN: Record<string, { label: string; variant: ReturnRow['statusVariant'] }> = {
  REQUESTED: { label: 'Awaiting you', variant: 'pending' },
  APPROVED: { label: 'Approved — refund to record', variant: 'approved' },
  REJECTED: { label: 'Declined', variant: 'rejected' },
  REFUNDED: { label: 'Refunded', variant: 'completed' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'cancelled' },
};
const INVOICE_RETURN: Record<string, { label: string; variant: ReturnRow['statusVariant'] }> = {
  REQUESTED: { label: 'Awaiting you', variant: 'pending' },
  APPROVED: { label: 'Approved', variant: 'completed' },
  REJECTED: { label: 'Declined', variant: 'rejected' },
};

export async function listAllReturns(params: {
  filter?: ReturnsFilter;
  source?: SourceFilter;
  q?: string;
  page?: number;
}): Promise<ActionResult<ReturnsPage>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;
    const filter = params.filter ?? 'open';
    const source = params.source ?? 'all';
    const q = params.q?.trim().slice(0, 80) ?? '';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const need = page * PAGE_SIZE;

    // "Waiting on you": a new request, or an online return approved but not yet refunded.
    const orderWhere = {
      organizationId,
      ...(filter === 'open' ? { status: { in: ['REQUESTED', 'APPROVED'] as ('REQUESTED' | 'APPROVED')[] } } : {}),
      ...(q
        ? {
            order: {
              OR: [
                { reference: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
                { firstName: { contains: q, mode: 'insensitive' as const } },
                { lastName: { contains: q, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };
    const invoiceWhere = {
      organizationId,
      ...(filter === 'open' ? { status: 'REQUESTED' as const } : {}),
      ...(q
        ? {
            invoice: {
              OR: [
                { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
                { customer: { name: { contains: q, mode: 'insensitive' as const } } },
              ],
            },
          }
        : {}),
    };

    const [orderReturns, invoiceReturns, orderCount, invoiceCount, openOrder, openInvoice] = await Promise.all([
      source === 'invoice'
        ? []
        : prisma.orderReturn.findMany({
            where: orderWhere,
            orderBy: { requestedAt: 'desc' },
            take: need,
            select: {
              id: true,
              status: true,
              reason: true,
              requestedAt: true,
              order: { select: { id: true, reference: true, firstName: true, lastName: true, email: true, currency: true } },
              lines: { select: { quantity: true } },
              refunds: { select: { amount: true } },
            },
          }),
      source === 'order'
        ? []
        : prisma.returnRequest.findMany({
            where: invoiceWhere,
            orderBy: { createdAt: 'desc' },
            take: need,
            select: {
              id: true,
              status: true,
              createdAt: true,
              invoice: { select: { invoiceNumber: true, currency: true, customer: { select: { name: true } } } },
              lineItems: { select: { quantity: true } },
            },
          }),
      source === 'invoice' ? 0 : prisma.orderReturn.count({ where: orderWhere }),
      source === 'order' ? 0 : prisma.returnRequest.count({ where: invoiceWhere }),
      prisma.orderReturn.count({ where: { organizationId, status: { in: ['REQUESTED', 'APPROVED'] } } }),
      prisma.returnRequest.count({ where: { organizationId, status: 'REQUESTED' } }),
    ]);

    const rows: ReturnRow[] = [
      ...orderReturns.map((r): ReturnRow => {
        const s = ORDER_RETURN[r.status] ?? { label: 'Open', variant: 'pending' as const };
        const name = `${r.order.firstName ?? ''} ${r.order.lastName ?? ''}`.trim();
        return {
          key: `order:${r.id}`,
          source: 'order',
          href: `/sales/orders/${r.order.id}`,
          reference: r.order.reference,
          customerName: name || r.order.email || 'A customer',
          status: r.status,
          statusLabel: s.label,
          statusVariant: s.variant,
          reason: isReturnReason(r.reason) ? RETURN_REASONS[r.reason] : r.reason,
          itemCount: r.lines.reduce((n, l) => n + l.quantity, 0),
          requestedAt: r.requestedAt.toISOString(),
          refunded: r.refunds.length ? r.refunds.reduce((n, x) => n + Number(x.amount), 0) : null,
          currency: r.order.currency,
        };
      }),
      ...invoiceReturns.map((r): ReturnRow => {
        const s = INVOICE_RETURN[r.status] ?? { label: 'Open', variant: 'pending' as const };
        return {
          key: `invoice:${r.id}`,
          source: 'invoice',
          href: `/sales/returns/${r.id}`,
          reference: r.invoice.invoiceNumber,
          customerName: r.invoice.customer.name,
          status: r.status,
          statusLabel: s.label,
          statusVariant: s.variant,
          reason: null,
          itemCount: r.lineItems.reduce((n, l) => n + Number(l.quantity), 0),
          requestedAt: r.createdAt.toISOString(),
          refunded: null,
          currency: r.invoice.currency,
        };
      }),
    ];
    rows.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

    return {
      success: true,
      data: {
        rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        total: orderCount + invoiceCount,
        page,
        pageSize: PAGE_SIZE,
        counts: { open: openOrder + openInvoice },
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load returns');
  }
}

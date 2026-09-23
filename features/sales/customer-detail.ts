'use server';

/*
 * features/sales/customer-detail.ts
 *
 * One customer, everything about them.
 *
 * What a merchant asks when they open a person: how much have they spent,
 * what do they buy, when were they last here, have they sent anything back,
 * and what did they say. All of it already exists across orders, returns,
 * reviews and questions — it had simply never been brought together.
 *
 * Cancelled orders are excluded from the money, the same rule the list uses:
 * somebody changing their mind is not custom.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, hasPermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import type { ActionResult } from './shared';

export interface CustomerOrderRow {
  id: string;
  reference: string;
  channel: string;
  status: string;
  paymentStatus: string;
  placedAt: string;
  itemCount: number;
  totalAmount: number;
  currency: string;
}

export interface CustomerProductRow {
  productId: string | null;
  name: string;
  quantity: number;
  spend: number;
}

export interface CustomerDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  status: string;
  tags: string[];
  notes: string | null;
  marketingConsent: boolean;
  consentUpdatedAt: string | null;
  createdAt: string;
  /** set when this record has an online account they can sign in with */
  hasAccount: boolean;
  lastLoginAt: string | null;

  metrics: {
    orderCount: number;
    totalSpend: number;
    averageOrder: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    /** orders with at least one return request, over orders — 0–1 */
    returnRatio: number | null;
    returnCount: number;
    outstandingInvoices: number;
    outstandingAmount: number;
  };

  orders: CustomerOrderRow[];
  topProducts: CustomerProductRow[];
  addresses: { id: string; line1: string; line2: string | null; city: string; state: string; isDefault: boolean }[];
  reviews: { id: string; productName: string; rating: number; title: string | null; status: string; createdAt: string }[];
  questions: { id: string; productName: string; body: string; status: string; createdAt: string }[];
  invoices: { id: string; invoiceNumber: string; status: string; totalAmount: number; paidAmount: number; dueDate: string | null }[];
  /** records folded into this one */
  mergedFrom: { id: string; name: string; mergedAt: string | null }[];
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to do that' };
  }
  console.error(`[customers] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function getCustomerDetail(customerId: string): Promise<ActionResult<CustomerDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_VIEW);
    const organizationId = ctx.organization.id;

    /* The id comes from a URL, so it is only ever used together with the
     * organization — another store's customer is a miss, not a leak. */
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        taxId: true,
        status: true,
        tags: true,
        notes: true,
        marketingConsent: true,
        consentUpdatedAt: true,
        createdAt: true,
        passwordHash: true,
        lastLoginAt: true,
        mergedIntoId: true,
        addresses: {
          select: { id: true, line1: true, line2: true, city: true, state: true, isDefault: true },
          orderBy: { isDefault: 'desc' },
        },
        mergedFrom: { select: { id: true, name: true, mergedAt: true } },
      },
    });
    if (!customer || customer.mergedIntoId) return { success: false, error: 'Customer not found' };

    const [orders, returnCount, invoices, reviews, questions] = await Promise.all([
      prisma.order.findMany({
        where: { organizationId, customerId },
        orderBy: { placedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          reference: true,
          channel: true,
          status: true,
          paymentStatus: true,
          placedAt: true,
          totalAmount: true,
          currency: true,
          lineItems: { select: { quantity: true, name: true, productId: true, totalPrice: true } },
        },
      }),
      prisma.orderReturn.count({ where: { organizationId, order: { customerId } } }),
      prisma.invoice.findMany({
        where: { organizationId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
          dueDate: true,
        },
      }),
      prisma.productReview.findMany({
        where: { organizationId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          rating: true,
          title: true,
          status: true,
          createdAt: true,
          product: { select: { name: true } },
        },
      }),
      prisma.productQuestion.findMany({
        where: { organizationId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          body: true,
          status: true,
          createdAt: true,
          product: { select: { name: true } },
        },
      }),
    ]);

    /* Money counts settled custom: a cancelled order is somebody changing
     * their mind. Same rule as the list, so the two never disagree. */
    const counted = orders.filter((o) => o.status !== 'CANCELLED');
    const totalSpend = counted.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    /* What they actually buy — by money, since three cheap things matter
     * less than one expensive one when deciding what to show them next. */
    const products = new Map<string, CustomerProductRow>();
    for (const order of counted) {
      for (const line of order.lineItems) {
        const key = line.productId ?? line.name;
        const existing = products.get(key);
        if (existing) {
          existing.quantity += line.quantity;
          existing.spend += Number(line.totalPrice);
        } else {
          products.set(key, {
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            spend: Number(line.totalPrice),
          });
        }
      }
    }

    const outstanding = invoices.filter(
      (inv) => inv.status !== 'VOID' && inv.status !== 'WRITTEN_OFF' && Number(inv.totalAmount) > Number(inv.paidAmount),
    );

    return {
      success: true,
      data: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        taxId: customer.taxId,
        status: customer.status,
        tags: customer.tags,
        notes: customer.notes,
        marketingConsent: customer.marketingConsent,
        consentUpdatedAt: customer.consentUpdatedAt?.toISOString() ?? null,
        createdAt: customer.createdAt.toISOString(),
        hasAccount: Boolean(customer.passwordHash) || Boolean(customer.lastLoginAt),
        lastLoginAt: customer.lastLoginAt?.toISOString() ?? null,

        metrics: {
          orderCount: counted.length,
          totalSpend,
          averageOrder: counted.length ? totalSpend / counted.length : 0,
          firstOrderAt: counted.at(-1)?.placedAt.toISOString() ?? null,
          lastOrderAt: counted[0]?.placedAt.toISOString() ?? null,
          /* Named `…Ratio` because it is 0–1 (AGENTS §10). Null rather than
           * zero when they have never ordered: "0% returns" would be a
           * compliment nobody earned. */
          returnRatio: counted.length ? returnCount / counted.length : null,
          returnCount,
          outstandingInvoices: outstanding.length,
          outstandingAmount: outstanding.reduce(
            (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
            0,
          ),
        },

        orders: orders.map((o) => ({
          id: o.id,
          reference: o.reference,
          channel: o.channel,
          status: o.status,
          paymentStatus: o.paymentStatus,
          placedAt: o.placedAt.toISOString(),
          itemCount: o.lineItems.reduce((sum, l) => sum + l.quantity, 0),
          totalAmount: Number(o.totalAmount),
          currency: o.currency,
        })),
        topProducts: [...products.values()].sort((a, b) => b.spend - a.spend).slice(0, 5),
        addresses: customer.addresses,
        reviews: reviews.map((r) => ({
          id: r.id,
          productName: r.product.name,
          rating: r.rating,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
        questions: questions.map((q) => ({
          id: q.id,
          productName: q.product.name,
          body: q.body,
          status: q.status,
          createdAt: q.createdAt.toISOString(),
        })),
        invoices: invoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          totalAmount: Number(inv.totalAmount),
          paidAmount: Number(inv.paidAmount),
          dueDate: inv.dueDate?.toISOString() ?? null,
        })),
        mergedFrom: customer.mergedFrom.map((m) => ({
          id: m.id,
          name: m.name,
          mergedAt: m.mergedAt?.toISOString() ?? null,
        })),
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load that customer');
  }
}

/** The merchant's own notes and labels. Never shown to the customer. */
export async function updateCustomerNotes(
  customerId: string,
  input: { notes?: string; tags?: string[] },
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_EDIT);

    const tags = input.tags
      ? [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 20)
      : undefined;

    const updated = await prisma.customer.updateMany({
      where: { id: customerId, organizationId: ctx.organization.id },
      data: {
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
        ...(tags ? { tags } : {}),
      },
    });
    if (updated.count === 0) return { success: false, error: 'Customer not found' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.customer.updated',
      entityType: 'Customer',
      entityId: customerId,
      metadata: { notes: input.notes !== undefined, tags: tags ?? undefined },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save that');
  }
}

/**
 * Record whether this person agreed to marketing.
 *
 * A merchant ticking a box here is saying the customer told them so — in the
 * shop, on the phone, on a form. The date is stamped because "when did they
 * agree" is the question that gets asked, and nothing may be sent to someone
 * without it (Phase 5).
 */
export async function setMarketingConsent(customerId: string, consented: boolean): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_EDIT);

    const updated = await prisma.customer.updateMany({
      where: { id: customerId, organizationId: ctx.organization.id },
      data: { marketingConsent: consented, consentUpdatedAt: new Date() },
    });
    if (updated.count === 0) return { success: false, error: 'Customer not found' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: consented ? 'sales.customer.consent_given' : 'sales.customer.consent_withdrawn',
      entityType: 'Customer',
      entityId: customerId,
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t record that');
  }
}

export interface MergeCandidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  orderCount: number;
  /** why this one is being suggested */
  reason: 'phone' | 'email' | 'name';
}

/**
 * Other records that look like the same person.
 *
 * Phone first, because that is what a counter sale takes and an online
 * account usually has; then email; then an exact name. A shared name alone
 * is the weakest signal, which is why it is offered for a human to confirm
 * rather than merged automatically.
 */
export async function findMergeCandidates(customerId: string): Promise<ActionResult<MergeCandidate[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_EDIT);
    const organizationId = ctx.organization.id;

    const self = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!self) return { success: false, error: 'Customer not found' };

    const matches = await prisma.customer.findMany({
      where: {
        organizationId,
        mergedIntoId: null,
        id: { not: self.id },
        OR: [
          ...(self.phone ? [{ phone: self.phone }] : []),
          ...(self.email ? [{ email: self.email }] : []),
          { name: { equals: self.name, mode: 'insensitive' as const } },
        ],
      },
      take: 10,
      select: { id: true, name: true, email: true, phone: true, _count: { select: { orders: true } } },
    });

    return {
      success: true,
      data: matches.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        orderCount: m._count.orders,
        reason: self.phone && m.phone === self.phone ? 'phone' : self.email && m.email === self.email ? 'email' : 'name',
      })),
    };
  } catch (error) {
    return failure(error, 'We couldn’t look for duplicates');
  }
}

/**
 * Fold one record into another: the same person, met twice.
 *
 * Everything they did moves to the survivor — orders, invoices, quotes,
 * reviews, questions, addresses, wishlist — so their history is finally in
 * one place and the metrics above count it once.
 *
 * The merged record is NOT deleted. It stays, pointing at the survivor, for
 * three reasons: a foreign key somewhere may still reference it, the merge
 * should be answerable afterwards, and deleting a customer row to tidy up a
 * duplicate is a lot of history to lose to a misclick. It is excluded from
 * every list and search instead.
 *
 * All of it in one transaction: a half-merged customer is worse than two.
 */
export async function mergeCustomers(loserId: string, survivorId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_EDIT);
    const organizationId = ctx.organization.id;

    if (loserId === survivorId) return { success: false, error: 'That’s the same customer' };

    const [loser, survivor] = await Promise.all([
      prisma.customer.findFirst({
        where: { id: loserId, organizationId },
        select: { id: true, name: true, email: true, phone: true, notes: true, tags: true, mergedIntoId: true },
      }),
      prisma.customer.findFirst({
        where: { id: survivorId, organizationId },
        select: { id: true, name: true, notes: true, tags: true, phone: true, mergedIntoId: true },
      }),
    ]);

    if (!loser || !survivor) return { success: false, error: 'One of those customers no longer exists' };
    if (loser.mergedIntoId || survivor.mergedIntoId) {
      return { success: false, error: 'One of those records has already been merged' };
    }

    await prisma.$transaction(async (tx) => {
      const move = { where: { customerId: loserId }, data: { customerId: survivorId } };
      await tx.order.updateMany(move);
      await tx.invoice.updateMany(move);
      await tx.quote.updateMany(move);
      await tx.productReview.updateMany(move);
      await tx.productQuestion.updateMany(move);
      await tx.customerAddress.updateMany(move);
      await tx.customerWishlistItem.updateMany(move);

      /* Keep what the merchant wrote about either of them, labelled, rather
       * than silently dropping one set of notes. */
      const notes = [survivor.notes, loser.notes && `Merged from ${loser.name}: ${loser.notes}`]
        .filter(Boolean)
        .join('\n\n');

      await tx.customer.update({
        where: { id: survivorId },
        data: {
          notes: notes || null,
          tags: [...new Set([...survivor.tags, ...loser.tags])].slice(0, 20),
          // Fill a gap from the duplicate; never overwrite what is there.
          phone: survivor.phone ?? loser.phone,
        },
      });

      await tx.customer.update({
        where: { id: loserId },
        data: {
          mergedIntoId: survivorId,
          mergedAt: new Date(),
          status: 'INACTIVE',
          /* The unique index is (organizationId, email). Releasing the
           * address means the survivor — or a future signup — can use it. */
          email: null,
        },
      });
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'sales.customer.merged',
      entityType: 'Customer',
      entityId: survivorId,
      metadata: { mergedFrom: loserId, mergedFromName: loser.name, into: survivor.name },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t merge those customers');
  }
}

/** Whether the signed-in member may edit customers — for the page to pass down. */
export async function canEditCustomers(): Promise<boolean> {
  const ctx = await getOrganizationContext();
  return hasPermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_EDIT);
}

/*
 * lib/payments/disputes.ts
 *
 * Chargebacks and disputes on storefront payments (ROADMAP 10.5), from
 * Paystack's `charge.dispute.create | remind | resolve` webhooks. Server only.
 *
 * The webhook's signature has already been checked; the body is Paystack's
 * record of the dispute and is stored as such. It is matched to OUR payment by
 * the transaction reference — a dispute on anything else (a subscription
 * charge, a reference we never issued) is logged and left alone.
 *
 * Disputes arrive at the PLATFORM's Paystack account, because the payment went
 * through it; whether a merchant can see or answer one in Paystack is still
 * unconfirmed (ROADMAP 10.13). So the platform is told (PLATFORM_ADMIN_EMAIL),
 * the shop's staff are told, and the order shows it — and nothing here claims
 * whose money a lost dispute comes from.
 */
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { sendPaymentDisputeEmail } from '@/lib/email';
import { getAdminUrl } from '@/lib/tenant/urls';
import { formatDate, formatMoney } from '@/lib/format';

export type DisputeOutcome = 'recorded' | 'updated' | 'stale' | 'not-ours';

type DisputePayload = {
  id?: unknown;
  status?: unknown;
  resolution?: unknown;
  category?: unknown;
  refund_amount?: unknown;
  currency?: unknown;
  dueAt?: unknown;
  resolvedAt?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  transaction?: { reference?: unknown; amount?: unknown; currency?: unknown } | null;
};

const date = (value: unknown): Date | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Record what Paystack says about a dispute. Idempotent on Paystack's dispute
 * id; an event older than the one already recorded changes nothing.
 */
export async function recordDispute(event: string, raw: unknown): Promise<DisputeOutcome> {
  const data = (raw ?? {}) as DisputePayload;
  const disputeId = data.id !== undefined && data.id !== null ? String(data.id) : null;
  const reference = text(data.transaction?.reference);
  if (!disputeId || !reference) return 'not-ours';

  const payment = await prisma.orderPayment.findUnique({
    where: { reference },
    select: { id: true, orderId: true, organizationId: true, currency: true },
  });
  if (!payment) return 'not-ours';

  const status = text(data.status) ?? (event === 'charge.dispute.resolve' ? 'resolved' : 'pending');
  const resolution = text(data.resolution);
  const eventAt =
    date(data.updated_at) ?? date(data.updatedAt) ?? date(data.resolvedAt) ?? date(data.created_at) ?? date(data.createdAt) ?? new Date();
  // Paystack reports amounts in the lowest unit (kobo), like the transaction.
  const minor = Number(data.refund_amount ?? data.transaction?.amount ?? 0);
  const fields = {
    status,
    resolution,
    category: text(data.category),
    amount: new Prisma.Decimal(Number.isFinite(minor) ? minor : 0).dividedBy(100),
    currency: text(data.currency) ?? text(data.transaction?.currency) ?? payment.currency,
    dueAt: date(data.dueAt),
    resolvedAt: date(data.resolvedAt) ?? (status === 'resolved' ? eventAt : null),
    lastEventAt: eventAt,
    providerPayload: data as Prisma.InputJsonValue,
  };

  const existing = await prisma.paymentDispute.findUnique({
    where: { providerDisputeId: disputeId },
    select: { id: true, lastEventAt: true, status: true },
  });

  let outcome: DisputeOutcome;
  if (!existing) {
    try {
      await prisma.paymentDispute.create({
        data: {
          ...fields,
          providerDisputeId: disputeId,
          organizationId: payment.organizationId,
          orderId: payment.orderId,
          paymentId: payment.id,
        },
      });
      outcome = 'recorded';
    } catch (error) {
      // The same event delivered twice at once: the other delivery recorded it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'stale';
      throw error;
    }
  } else {
    if (existing.lastEventAt > eventAt) return 'stale';
    await prisma.paymentDispute.update({ where: { id: existing.id }, data: fields });
    outcome = 'updated';
  }

  const resolved = status === 'resolved';
  await createAuditLog({
    organizationId: payment.organizationId,
    userId: null,
    action: outcome === 'recorded' ? 'platform.payments.dispute_opened' : resolved ? 'platform.payments.dispute_resolved' : 'platform.payments.dispute_updated',
    entityType: 'Order',
    entityId: payment.orderId,
    metadata: { disputeId, status, resolution },
  });

  // Told on the way in and on the way out — not on every reminder.
  if (outcome === 'recorded' || (resolved && existing?.status !== 'resolved')) {
    await notify(payment.orderId, outcome === 'recorded' ? 'opened' : 'resolved', {
      amount: fields.amount,
      currency: fields.currency,
      dueAt: fields.dueAt,
      resolution,
    });
  }
  return outcome;
}

async function notify(
  orderId: string,
  kind: 'opened' | 'resolved',
  detail: { amount: Prisma.Decimal; currency: string; dueAt: Date | null; resolution: string | null },
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, reference: true, organizationId: true, organization: { select: { name: true, slug: true } } },
    });
    if (!order) return;
    const members = await prisma.membership.findMany({
      where: {
        organizationId: order.organizationId,
        status: 'ACTIVE',
        role: {
          OR: [
            { rolePermissions: { some: { permission: { key: PERMISSIONS.SALES_FULFILLMENT_MANAGE } } } },
            { isSystem: true, name: SYSTEM_ROLES.OWNER.name },
          ],
        },
      },
      select: { user: { select: { email: true } } },
    });
    const to = [...new Set(members.map((m) => m.user.email).filter((e): e is string => Boolean(e)))];
    const platform = process.env.PLATFORM_ADMIN_EMAIL;
    await sendPaymentDisputeEmail({
      to: platform && !to.includes(platform) ? [...to, platform] : to,
      kind,
      storeName: order.organization.name,
      reference: order.reference,
      amount: formatMoney(detail.amount.toNumber(), detail.currency),
      dueDate: detail.dueAt ? formatDate(detail.dueAt) : null,
      resolution: detail.resolution,
      orderUrl: getAdminUrl(order.organization.slug, `/sales/orders/${order.id}`),
    });
  } catch (error) {
    console.error(`[disputes] could not notify about order ${orderId}:`, error);
  }
}

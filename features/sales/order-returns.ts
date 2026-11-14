'use server';

/*
 * features/sales/order-returns.ts
 *
 * Online-store returns and refunds, for the merchant: answering a customer's
 * return request, and recording money sent back — for a return, or for an
 * order cancelled after it was paid.
 *
 * Reading needs `sales.view`; every change needs `sales.return.manage` and is
 * audit-logged. What's allowed (which state, how much) is decided in
 * lib/storefront/orders/returns.ts; this only checks who is asking.
 *
 * Money is MAJOR units here, like the rest of the admin. The app sends no
 * money: the merchant sends it back from their own bank (online payments
 * settle there through Paystack), then records it, and the customer is
 * emailed that the store says it's sent.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { requireStoreAccess } from '@/lib/store-access';
import {
  approveReturn,
  recordCounterReturn,
  refundCancelledOrder,
  refundReturn,
  rejectReturn,
  type ReturnResult,
} from '@/lib/storefront/orders/returns';
import { RETURN_REASONS, isCounterRefundMethod, isReturnReason } from '@/lib/storefront/orders/policy';
import type { ActionResult } from './shared';

function denied(error: unknown, fallback: string): { success: false; error: string } {
  // A store this member doesn't work in — the message says what to do (Phase 8.6).
  if (error instanceof Error && error.name === 'StoreAccessDeniedError') return { success: false, error: error.message };
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to manage returns and refunds' };
  }
  console.error(`[order-returns] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function manage() {
  const ctx = await getOrganizationContext();
  requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_RETURN_MANAGE);
  return ctx;
}

async function done(
  ctx: Awaited<ReturnType<typeof manage>>,
  result: ReturnResult,
  audit: { action: string; entityType: string; entityId: string; metadata?: Record<string, string | number | boolean> },
): Promise<ActionResult> {
  if (!result.ok) return { success: false, error: result.error };
  await createAuditLog({ organizationId: ctx.organization.id, userId: ctx.userId, ...audit });
  return { success: true, data: undefined };
}

export async function approveOrderReturn(returnId: string, note: string): Promise<ActionResult> {
  try {
    const ctx = await manage();
    const result = await approveReturn({ organizationId: ctx.organization.id, returnId, note });
    return done(ctx, result, { action: 'sales.order_return.approved', entityType: 'OrderReturn', entityId: returnId });
  } catch (error) {
    return denied(error, 'We couldn’t approve this return. Please try again.');
  }
}

export async function rejectOrderReturn(returnId: string, note: string): Promise<ActionResult> {
  try {
    const ctx = await manage();
    const result = await rejectReturn({ organizationId: ctx.organization.id, returnId, note });
    return done(ctx, result, {
      action: 'sales.order_return.rejected',
      entityType: 'OrderReturn',
      entityId: returnId,
      metadata: { note },
    });
  } catch (error) {
    return denied(error, 'We couldn’t decline this return. Please try again.');
  }
}

const RefundSchema = z.object({
  amount: z.number().positive('Enter the amount you sent back').max(1_000_000_000),
  note: z.string().max(500).optional(),
});

export async function refundOrderReturn(
  returnId: string,
  input: { amount: number; note?: string; restock: boolean },
): Promise<ActionResult> {
  try {
    const ctx = await manage();
    const parsed = RefundSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the amount' };

    const result = await refundReturn({
      organizationId: ctx.organization.id,
      returnId,
      amount: parsed.data.amount,
      note: parsed.data.note,
      restock: Boolean(input.restock),
      performedById: ctx.userId,
    });
    return done(ctx, result, {
      action: 'sales.order_return.refunded',
      entityType: 'OrderReturn',
      entityId: returnId,
      metadata: { amount: parsed.data.amount, restock: Boolean(input.restock) },
    });
  } catch (error) {
    return denied(error, 'We couldn’t record this refund. Please try again.');
  }
}

export async function refundCancelledStoreOrder(
  orderId: string,
  input: { amount: number; note?: string },
): Promise<ActionResult> {
  try {
    const ctx = await manage();
    const parsed = RefundSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the amount' };

    const result = await refundCancelledOrder({
      organizationId: ctx.organization.id,
      orderId,
      amount: parsed.data.amount,
      note: parsed.data.note,
      performedById: ctx.userId,
    });
    return done(ctx, result, {
      action: 'sales.order.refunded',
      entityType: 'Order',
      entityId: orderId,
      metadata: { amount: parsed.data.amount },
    });
  } catch (error) {
    return denied(error, 'We couldn’t record this refund. Please try again.');
  }
}

/* ---------------- returns at the counter (ROADMAP 14.7) ---------------- */

const CounterReturnSchema = z.object({
  lines: z
    .array(z.object({ orderLineItemId: z.string().min(1).max(64), quantity: z.number().int().min(0).max(100_000) }))
    .min(1)
    .max(500),
  reason: z.string().max(40),
  details: z.string().max(1000).optional(),
  refundAmount: z.number().min(0, 'Enter the amount given back, or 0 for none').max(1_000_000_000),
  refundMethod: z.string().max(20).optional(),
  refundNote: z.string().max(400).optional(),
  restock: z.boolean(),
});

/**
 * A counter sale brought back to the shop: the items, the money handed back
 * (or none), and the stock back on the selling store's shelf — recorded in
 * one go (lib/storefront/orders/returns.ts `recordCounterReturn`). The member
 * must be able to work in the store that made the sale (8.6).
 */
export async function recordCounterReturnAction(
  orderId: string,
  input: z.input<typeof CounterReturnSchema>,
): Promise<ActionResult<{ returnId: string }>> {
  try {
    const ctx = await manage();
    const parsed = CounterReturnSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the return' };

    const order = await prisma.order.findFirst({
      where: { id: orderId, organizationId: ctx.organization.id },
      select: { id: true, reference: true, warehouse: { select: { id: true, name: true } } },
    });
    if (!order) return { success: false, error: 'Order not found' };
    if (order.warehouse) requireStoreAccess(ctx.membership, order.warehouse.id, order.warehouse.name);

    const result = await recordCounterReturn({
      organizationId: ctx.organization.id,
      orderId: order.id,
      lines: parsed.data.lines,
      reason: parsed.data.reason,
      details: parsed.data.details,
      refundAmount: parsed.data.refundAmount,
      refundMethod: isCounterRefundMethod(parsed.data.refundMethod) ? parsed.data.refundMethod : null,
      refundNote: parsed.data.refundNote,
      restock: parsed.data.restock,
      performedById: ctx.userId,
    });
    if (!result.ok) return { success: false, error: result.error };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.order_return.counter_recorded',
      entityType: 'OrderReturn',
      entityId: result.data.id,
      metadata: {
        reference: order.reference,
        store: order.warehouse?.name ?? '',
        items: parsed.data.lines.reduce((sum, line) => sum + line.quantity, 0),
        refunded: result.data.refunded,
        refundMethod: result.data.refunded > 0 ? (parsed.data.refundMethod ?? '') : '',
        restock: parsed.data.restock,
      },
    });
    return { success: true, data: { returnId: result.data.id } };
  } catch (error) {
    return denied(error, 'We couldn’t record this return. Please try again.');
  }
}

/* ---------------- the list ---------------- */

export interface OrderReturnListRow {
  id: string;
  orderId: string;
  reference: string;
  customerName: string;
  status: string;
  reasonLabel: string;
  itemCount: number;
  requestedAt: string;
  currency: string;
  /** what was refunded for it, if anything */
  refunded: number | null;
}

export type OrderReturnFilter = 'open' | 'all' | 'REQUESTED' | 'APPROVED' | 'REFUNDED' | 'REJECTED' | 'WITHDRAWN';

const PAGE_SIZE = 25;

/**
 * Sales → Returns → Online store. "Open" (the default) is everything still
 * waiting on the merchant: new requests and approved ones not yet refunded.
 */
export async function listOrderReturns(params: {
  filter?: OrderReturnFilter;
  query?: string;
  page?: number;
}): Promise<
  ActionResult<{ rows: OrderReturnListRow[]; total: number; page: number; pageSize: number; openCount: number }>
> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const filter = params.filter ?? 'open';
    const query = params.query?.trim().slice(0, 80) ?? '';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const openStatuses = ['REQUESTED', 'APPROVED'] as const;

    const where = {
      organizationId: ctx.organization.id,
      ...(filter === 'open'
        ? { status: { in: [...openStatuses] } }
        : filter === 'all'
          ? {}
          : { status: filter }),
      ...(query
        ? {
            order: {
              OR: [
                { reference: { contains: query, mode: 'insensitive' as const } },
                { email: { contains: query, mode: 'insensitive' as const } },
                { firstName: { contains: query, mode: 'insensitive' as const } },
                { lastName: { contains: query, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };

    const [rows, total, openCount] = await Promise.all([
      prisma.orderReturn.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
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
      prisma.orderReturn.count({ where }),
      prisma.orderReturn.count({ where: { organizationId: ctx.organization.id, status: { in: [...openStatuses] } } }),
    ]);

    return {
      success: true,
      data: {
        rows: rows.map((r) => ({
          id: r.id,
          orderId: r.order.id,
          reference: r.order.reference,
          customerName: `${r.order.firstName ?? ''} ${r.order.lastName ?? ''}`.trim() || r.order.email || 'A customer',
          status: r.status,
          reasonLabel: isReturnReason(r.reason) ? RETURN_REASONS[r.reason] : r.reason,
          itemCount: r.lines.reduce((sum, line) => sum + line.quantity, 0),
          requestedAt: r.requestedAt.toISOString(),
          currency: r.order.currency,
          refunded: r.refunds.length ? r.refunds.reduce((sum, x) => sum + Number(x.amount), 0) : null,
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
        openCount,
      },
    };
  } catch (error) {
    return denied(error, 'Failed to load returns');
  }
}

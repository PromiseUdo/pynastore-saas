'use server';

/*
 * features/sales/discounts.ts
 *
 * The merchant's discount codes: what a shopper may type at checkout, what
 * it takes off, and the limits on it. Checkout resolves against exactly
 * these records (lib/storefront/discounts/) — nothing is built into the app.
 *
 * Viewing needs `sales.view`; changing needs `sales.discount.manage`, which
 * is its own permission because a discount code hands away money.
 *
 * Money arrives and leaves in MAJOR units (naira), like the rest of the
 * admin; the storefront converts at its own edge.
 *
 * A code that has been used is never deleted — the orders that used it point
 * at it. It is switched OFF instead, which stops it working immediately and
 * keeps the history readable.
 */
import { z } from 'zod';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { CODE_PATTERN, normalizeCode } from '@/lib/storefront/discounts/rules';

type Result<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

/* ---------------- reading ---------------- */

export interface DiscountCodeRow {
  id: string;
  code: string;
  label: string;
  kind: 'PERCENT' | 'FIXED';
  /** percent (1–100), or an amount off in major units */
  value: number;
  minSubtotal: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usageCount: number;
  isActive: boolean;
  /** what the orders that used it came to, in major units */
  totalDiscounted: number;
  createdAt: string;
}

const num = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));
const iso = (value: Date | null) => (value === null ? null : value.toISOString());

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change discount codes' };
  }
  console.error(`[sales/discounts] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function context(permission: 'view' | 'manage') {
  const ctx = await getOrganizationContext();
  requirePermission(
    ctx.membership.role.permissions,
    permission === 'view' ? PERMISSIONS.SALES_VIEW : PERMISSIONS.SALES_DISCOUNT_MANAGE,
  );
  return ctx;
}

export async function listDiscountCodes(): Promise<Result<DiscountCodeRow[]>> {
  try {
    const ctx = await context('view');

    const [codes, discounted] = await Promise.all([
      prisma.discountCode.findMany({
        where: { organizationId: ctx.organization.id },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      }),
      /* What each code has actually cost, from the orders themselves rather
       * than from the code's own settings — a percentage code's worth
       * depends entirely on what people bought with it. */
      prisma.order.groupBy({
        by: ['discountCodeId'],
        where: {
          organizationId: ctx.organization.id,
          discountCodeId: { not: null },
          status: { not: 'CANCELLED' },
        },
        _sum: { discount: true },
      }),
    ]);

    const spendByCode = new Map(
      discounted.map((row) => [row.discountCodeId, Number(row._sum.discount ?? 0)]),
    );

    return {
      success: true,
      data: codes.map((code) => ({
        id: code.id,
        code: code.code,
        label: code.label,
        kind: code.kind,
        value: Number(code.value),
        minSubtotal: num(code.minSubtotal),
        startsAt: iso(code.startsAt),
        endsAt: iso(code.endsAt),
        usageLimit: code.usageLimit,
        perCustomerLimit: code.perCustomerLimit,
        usageCount: code.usageCount,
        isActive: code.isActive,
        totalDiscounted: spendByCode.get(code.id) ?? 0,
        createdAt: code.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your discount codes');
  }
}

/* ---------------- saving ---------------- */

const optionalPositiveInt = (label: string, max: number) =>
  z
    .union([z.literal(''), z.null(), z.coerce.number()])
    .transform((v) => (v === '' || v === null ? null : v))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= max), {
      message: `${label} must be a whole number between 1 and ${max}`,
    });

const optionalMoney = z
  .union([z.literal(''), z.null(), z.coerce.number()])
  .transform((v) => (v === '' || v === null ? null : v))
  .refine((v) => v === null || (v >= 0 && v <= 1_000_000_000), { message: 'That amount looks too high' });

const optionalDate = z
  .union([z.literal(''), z.null(), z.string(), z.date()])
  .transform((v) => {
    if (v === '' || v === null) return null;
    const date = v instanceof Date ? v : new Date(v);
    return Number.isNaN(date.getTime()) ? null : date;
  });

const DiscountSchema = z
  .object({
    code: z.string().transform(normalizeCode),
    label: z.string().trim(),
    kind: z.enum(['PERCENT', 'FIXED']),
    value: z.coerce.number({ error: 'Enter how much it takes off' }),
    minSubtotal: optionalMoney,
    startsAt: optionalDate,
    endsAt: optionalDate,
    usageLimit: optionalPositiveInt('The total limit', 1_000_000),
    perCustomerLimit: optionalPositiveInt('The per-customer limit', 1_000),
    isActive: z.boolean().default(true),
  })
  .superRefine((discount, ctx) => {
    if (!CODE_PATTERN.test(discount.code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Use 3–32 letters, numbers or dashes — no spaces',
      });
    }
    if (discount.label.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'Say what the code gives, e.g. “10% off your first order”' });
    } else if (discount.label.length > 80) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'Keep it under 80 characters' });
    }
    if (discount.kind === 'PERCENT') {
      if (!(discount.value > 0 && discount.value <= 100)) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage must be between 1 and 100' });
      }
    } else if (!(discount.value > 0 && discount.value <= 1_000_000_000)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an amount above zero' });
    }
    if (discount.startsAt && discount.endsAt && discount.endsAt <= discount.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end date must be after the start date' });
    }
  });

export type DiscountCodeInput = z.input<typeof DiscountSchema>;

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function saveDiscountCode(
  codeId: string | null,
  input: DiscountCodeInput,
): Promise<Result<{ id: string }>> {
  try {
    const ctx = await context('manage');
    const parsed = DiscountSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Check the highlighted fields', fieldErrors: fieldErrors(parsed.error) };
    }
    const discount = parsed.data;

    /* Two codes that read the same to a shopper are the same code. The
     * database enforces it too; this is so the merchant gets told which
     * field to fix rather than "something went wrong". */
    const clash = await prisma.discountCode.findFirst({
      where: {
        organizationId: ctx.organization.id,
        code: discount.code,
        ...(codeId ? { NOT: { id: codeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      return {
        success: false,
        error: `You already have a code called ${discount.code}`,
        fieldErrors: { code: 'You already have a code with this name' },
      };
    }

    const data = {
      code: discount.code,
      label: discount.label,
      kind: discount.kind,
      value: new Prisma.Decimal(discount.value),
      minSubtotal: discount.minSubtotal === null ? null : new Prisma.Decimal(discount.minSubtotal),
      startsAt: discount.startsAt,
      endsAt: discount.endsAt,
      usageLimit: discount.usageLimit,
      perCustomerLimit: discount.perCustomerLimit,
      isActive: discount.isActive,
    };

    let id: string;
    if (codeId) {
      const updated = await prisma.discountCode.updateMany({
        where: { id: codeId, organizationId: ctx.organization.id },
        data,
      });
      if (!updated.count) return { success: false, error: 'That code no longer exists' };
      id = codeId;
    } else {
      id = (
        await prisma.discountCode.create({
          data: { ...data, organizationId: ctx.organization.id },
          select: { id: true },
        })
      ).id;
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: codeId ? 'sales.discount_code.update' : 'sales.discount_code.create',
      entityType: 'DiscountCode',
      entityId: id,
      metadata: { code: data.code, kind: data.kind, value: discount.value },
    });

    return { success: true, data: { id } };
  } catch (error) {
    return failure(error, 'We couldn’t save this discount code');
  }
}

export async function setDiscountCodeActive(codeId: string, isActive: boolean): Promise<Result> {
  try {
    const ctx = await context('manage');
    const updated = await prisma.discountCode.updateMany({
      where: { id: codeId, organizationId: ctx.organization.id },
      data: { isActive },
    });
    if (!updated.count) return { success: false, error: 'That code no longer exists' };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: isActive ? 'sales.discount_code.activate' : 'sales.discount_code.deactivate',
      entityType: 'DiscountCode',
      entityId: codeId,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t change this code');
  }
}

export async function deleteDiscountCode(codeId: string): Promise<Result> {
  try {
    const ctx = await context('manage');

    const code = await prisma.discountCode.findFirst({
      where: { id: codeId, organizationId: ctx.organization.id },
      select: { code: true, usageCount: true },
    });
    if (!code) return { success: false, error: 'That code no longer exists' };

    /* Used codes are switched off, never removed: an order that was placed
     * with one is a record of what the customer was charged, and the code is
     * part of that record. */
    if (code.usageCount > 0) {
      return {
        success: false,
        error: `${code.code} has been used on ${code.usageCount} order${code.usageCount === 1 ? '' : 's'}, so it can’t be deleted. Switch it off instead.`,
      };
    }

    await prisma.discountCode.delete({ where: { id: codeId } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.discount_code.delete',
      entityType: 'DiscountCode',
      entityId: codeId,
      metadata: { code: code.code },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t remove this discount code');
  }
}

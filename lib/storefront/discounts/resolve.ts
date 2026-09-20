/*
 * lib/storefront/discounts/resolve.ts
 *
 * A store's discount codes, read from the merchant's own records.
 *
 * Server only — the cart's "apply" action, and order placement, both come
 * through here, and both then run ./rules.ts. Nothing about a code reaches
 * the browser except the code, its label and what it takes off; the limits,
 * the dates and how many are left stay on this side.
 *
 * EVERY READ NAMES ITS STORE. A code belongs to one merchant, and
 * `WELCOME10` in one shop has nothing to do with `WELCOME10` in another.
 *
 * Money leaves here in MINOR units (kobo); the database keeps major units.
 *
 * Under the demo fixtures (tests, STOREFRONT_FIXTURES=1) a small demo set
 * stands in, so a storefront with no database still has a code to try.
 */
import { prisma } from '@/lib/prisma';
import { formatMoney } from '../format';
import { useFixtures } from '../data/current';
import type { AppliedCoupon, Money } from '../types';
import {
  checkDiscount,
  normalizeCode,
  UNKNOWN_CODE_MESSAGE,
  type DiscountCheck,
  type DiscountRecord,
} from './rules';

const toMinor = (value: { toString(): string } | null): Money | null =>
  value === null ? null : Math.round(Number(value.toString()) * 100);

/** The demo codes. Fixtures only — a real store has exactly what it created. */
const FIXTURE_CODES: DiscountRecord[] = [
  {
    id: 'demo-welcome10',
    code: 'WELCOME10',
    label: '10% off your first order',
    kind: 'percent',
    value: 10,
    minSubtotal: null,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    usageCount: 0,
    isActive: true,
  },
  {
    id: 'demo-take5k',
    code: 'TAKE5K',
    label: '₦5,000 off orders over ₦40,000',
    kind: 'fixed',
    value: 500_000,
    minSubtotal: 4_000_000,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    usageCount: 0,
    isActive: true,
  },
];

/** One store's code, by what the shopper typed. Null if there is no such code. */
export async function findDiscountCode(
  organizationSlug: string,
  code: string,
): Promise<DiscountRecord | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;

  if (useFixtures()) return FIXTURE_CODES.find((c) => c.code === normalized) ?? null;

  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!org) return null;

  const record = await prisma.discountCode.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: normalized } },
  });
  if (!record) return null;

  return {
    id: record.id,
    code: record.code,
    label: record.label,
    kind: record.kind === 'PERCENT' ? 'percent' : 'fixed',
    value: record.kind === 'PERCENT' ? Number(record.value) : (toMinor(record.value) ?? 0),
    minSubtotal: toMinor(record.minSubtotal),
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    usageLimit: record.usageLimit,
    perCustomerLimit: record.perCustomerLimit,
    usageCount: record.usageCount,
    isActive: record.isActive,
  };
}

/** How many of this shopper's orders already used this code. */
async function customerUses(
  organizationSlug: string,
  discountCodeId: string,
  customerId: string | null,
): Promise<number> {
  if (!customerId || useFixtures()) return 0;
  return prisma.order.count({
    where: {
      customerId,
      discountCodeId,
      organization: { slug: organizationSlug },
      // A cancelled order didn't get the discount, so it shouldn't spend an allowance.
      status: { not: 'CANCELLED' },
    },
  });
}

export interface ResolveDiscountInput {
  organizationSlug: string;
  code: string;
  /** the goods, in minor units */
  subtotal: Money;
  /** the signed-in shopper, for a per-customer limit; guests have none */
  customerId?: string | null;
  currency?: string;
  now?: Date;
}

export type ResolvedDiscount =
  /** `recordId` is the merchant's record to link the order to — null under
   *  the demo fixtures, which have no rows to point at. */
  | { ok: true; coupon: AppliedCoupon; recordId: string | null }
  | { ok: false; message: string };

/**
 * Can this shopper use this code on this bag, right now?
 *
 * The one answer both the cart and order placement take. It does NOT claim a
 * use — that happens with the order, in the order's own transaction (see
 * `claimDiscountUse`), so two shoppers can't both take the last one.
 */
export async function resolveDiscount(input: ResolveDiscountInput): Promise<ResolvedDiscount> {
  const record = await findDiscountCode(input.organizationSlug, input.code);
  if (!record) return { ok: false, message: UNKNOWN_CODE_MESSAGE };

  const uses = await customerUses(input.organizationSlug, record.id, input.customerId ?? null);

  const result: DiscountCheck = checkDiscount(
    record,
    { subtotal: input.subtotal, now: input.now ?? new Date(), customerUses: uses },
    (minor) => formatMoney(minor, input.currency ?? 'NGN'),
  );

  return result.ok
    ? { ok: true, coupon: result.coupon, recordId: useFixtures() ? null : record.id }
    : { ok: false, message: result.message };
}

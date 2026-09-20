/*
 * lib/storefront/discounts/rules.ts
 *
 * Whether a discount code may be used, decided in one place.
 *
 * Pure: it takes a merchant's code record and the facts about this order and
 * answers yes or no. No database, no clock of its own, no React — so the
 * cart's "apply" and the server's re-check at order time run the SAME rules,
 * and a shopper is never told a code works and then charged as if it didn't.
 *
 * Money in and out is MINOR units (kobo); the resolver converts.
 */
import type { AppliedCoupon, Money } from '../types';

/** A merchant's code, as the storefront needs it. Mirrors `DiscountCode`. */
export interface DiscountRecord {
  id: string;
  code: string;
  label: string;
  kind: 'percent' | 'fixed';
  /** percent (1–100), or an amount off in minor units */
  value: number;
  minSubtotal: Money | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usageCount: number;
  isActive: boolean;
}

export interface DiscountContext {
  /** the goods, before delivery */
  subtotal: Money;
  now: Date;
  /** how many orders this shopper has already placed with this code */
  customerUses: number;
}

export type DiscountRejection =
  | 'unknown'
  | 'inactive'
  | 'not-started'
  | 'expired'
  | 'used-up'
  | 'customer-limit'
  | 'below-minimum';

export type DiscountCheck =
  | { ok: true; coupon: AppliedCoupon }
  | { ok: false; reason: DiscountRejection; message: string };

/** Codes are typed by people: case and stray spaces are not part of them. */
export function normalizeCode(code: string): string {
  return String(code ?? '').trim().toUpperCase();
}

/** A code is 3–32 characters of letters, numbers and dashes. */
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/;

/**
 * The shopper-facing reason a code didn't work.
 *
 * Deliberately vague about WHY a code is unusable — "isn't valid" covers a
 * code that never existed, one the merchant switched off and one that ran
 * out, because a message that distinguishes them is a way to go fishing for
 * other people's codes. The two the shopper can act on — a minimum spend and
 * an expiry — say so, because those are the shopper's own business.
 */
function reject(reason: DiscountRejection, message: string): DiscountCheck {
  return { ok: false, reason, message };
}

export const UNKNOWN_CODE_MESSAGE = 'That code isn’t valid.';

export function checkDiscount(
  record: DiscountRecord | null,
  context: DiscountContext,
  formatMoney: (minor: Money) => string,
): DiscountCheck {
  if (!record) return reject('unknown', UNKNOWN_CODE_MESSAGE);
  if (!record.isActive) return reject('inactive', UNKNOWN_CODE_MESSAGE);

  if (record.startsAt && context.now < record.startsAt) {
    return reject('not-started', 'That code isn’t available yet.');
  }
  if (record.endsAt && context.now > record.endsAt) {
    return reject('expired', 'That code has expired.');
  }
  if (record.usageLimit !== null && record.usageCount >= record.usageLimit) {
    return reject('used-up', 'That code has been fully claimed.');
  }
  if (record.perCustomerLimit !== null && context.customerUses >= record.perCustomerLimit) {
    return reject(
      'customer-limit',
      record.perCustomerLimit === 1
        ? 'You’ve already used that code.'
        : 'You’ve used that code as many times as it allows.',
    );
  }
  if (record.minSubtotal !== null && context.subtotal < record.minSubtotal) {
    return reject('below-minimum', `Spend ${formatMoney(record.minSubtotal)} to use this code.`);
  }

  return { ok: true, coupon: toAppliedCoupon(record) };
}

/** The record reduced to what the cart and the totals need. */
export function toAppliedCoupon(record: DiscountRecord): AppliedCoupon {
  return {
    code: record.code,
    label: record.label,
    kind: record.kind,
    value: record.value,
    minSubtotal: record.minSubtotal,
  };
}

/*
 * lib/trade/rules.ts
 *
 * Wholesale's plain rules (ROADMAP 21.1), in one place. Pure — safe on the
 * client and the server, and tested without a database.
 *
 *   - what each mode and status is called on screen (never the enum);
 *   - which pages of a "Trade only" shop stay open to everyone;
 *   - which ways a trade buyer may pay;
 *   - what a business has to tell us.
 */
import { z } from 'zod';

export type WholesaleMode = 'OFF' | 'RETAIL_AND_TRADE' | 'TRADE_ONLY';
export type TradeStatus = 'REQUESTED' | 'APPROVED' | 'DECLINED' | 'SUSPENDED';

export const WHOLESALE_MODES: { value: WholesaleMode; label: string; hint: string }[] = [
  { value: 'OFF', label: 'Off', hint: 'Everyone shops at your normal prices. Nobody is a trade buyer.' },
  {
    value: 'RETAIL_AND_TRADE',
    label: 'Retail and trade',
    hint: 'Everyone can shop. Businesses you approve shop as trade buyers.',
  },
  {
    value: 'TRADE_ONLY',
    label: 'Trade only',
    hint: 'Only businesses you approve can see your products and order. Everyone else is asked to sign in or ask for a trade account.',
  },
];

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  REQUESTED: 'Asked for trade',
  APPROVED: 'Trade buyer',
  DECLINED: 'Trade declined',
  SUSPENDED: 'Trade paused',
};

export const TRADE_STATUS_VARIANT: Record<TradeStatus, 'pending' | 'success' | 'rejected' | 'cancelled'> = {
  REQUESTED: 'pending',
  APPROVED: 'success',
  DECLINED: 'rejected',
  SUSPENDED: 'cancelled',
};

/** Wholesale is on: there can be trade buyers. */
export function wholesaleOn(mode: WholesaleMode): boolean {
  return mode !== 'OFF';
}

/**
 * The pages of a "Trade only" shop everyone may open: signing in or
 * creating an account, their account (where the request form is), the
 * merchant's own pages (terms, delivery, about), and the page that explains
 * wholesale. Everything that shows a product or a price is behind the gate —
 * except a bill: an invoice link (the merchant's, or a trade order's, 21.6)
 * is opened by its secret token, often from an email before signing in, and
 * shows one customer only what they were billed.
 * `path` is the store-relative path (proxy.ts's `x-store-path`).
 */
const OPEN_IN_TRADE_ONLY = ['/account', '/pages', '/wholesale', '/invoice', '/order-invoice'];

export function openInTradeOnly(path: string | null | undefined): boolean {
  const clean = (path ?? '/').split(/[?#]/)[0] || '/';
  return OPEN_IN_TRADE_ONLY.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
}

export interface TradePaymentRules {
  tradePayOnline: boolean;
  tradePayTransfer: boolean;
  tradePayOnDelivery: boolean;
}

/** The checkout method ids (lib/storefront/checkout/payment-methods.ts) a trade buyer may use. */
export function tradeMayPayWith(methodId: string, rules: TradePaymentRules): boolean {
  switch (methodId) {
    case 'paystack':
      return rules.tradePayOnline;
    case 'transfer':
      return rules.tradePayTransfer;
    case 'pod':
      return rules.tradePayOnDelivery;
    default:
      return false;
  }
}

/* ---------------- what a business tells us ---------------- */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const BusinessDetailsSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter the business name').max(150, 'Keep the business name under 150 characters'),
  /** Tax Identification Number — optional; kept on the customer, where invoices read it */
  taxId: optional(60),
  /** Corporate Affairs Commission number (RC/BN) — optional */
  cacNumber: optional(40),
});

export const TradeRequestSchema = BusinessDetailsSchema.extend({
  note: optional(500),
});

export type BusinessDetails = z.infer<typeof BusinessDetailsSchema>;
export type TradeRequestInput = z.input<typeof TradeRequestSchema>;

/** First error per field, for showing beside each input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

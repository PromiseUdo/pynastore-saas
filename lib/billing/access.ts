// lib/billing/access.ts
//
// Whether a workspace is paid up — the one rule (ROADMAP 12.1). Pure and
// client-safe; lib/billing/entitlements.ts applies it to the database.
//
//   trial   a free trial is running (no card taken)
//   active  a paid period is running
//   grace   the trial or paid period ended; everything still works, under a
//           countdown, until graceEndsAt
//   lapsed  grace is over: the storefront shows a closed page and takes no
//           orders, and the dashboard opens only to billing and to finishing
//           orders already placed
//   none    no subscription row at all — only old test data (every workspace
//           created since 12.1 has one). Nothing is locked; the plan is NO_PLAN.
//
// There is no scheduler: the moment a subscription is found to have ended is
// when its lapse is RECORDED (lapsedAt + graceEndsAt, with the grace days read
// then), so changing the grace setting later never moves a merchant's deadline.

export type AccessState = 'trial' | 'active' | 'grace' | 'lapsed' | 'none';

export type SubscriptionStatusKey = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE';

export interface SubscriptionFacts {
  status: SubscriptionStatusKey;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lapsedAt: Date | null;
  graceEndsAt: Date | null;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long past the end of a paid period a renewal may take to arrive before
 * the period counts as ended. Paystack charges on the due date and tells us by
 * webhook; a day or two of lag must not close a shop.
 */
export const RENEWAL_TOLERANCE_DAYS = 3;

/** When this subscription's access ended — or null while it is still running. */
export function accessEndedAt(s: SubscriptionFacts, now: Date): Date | null {
  switch (s.status) {
    case 'TRIALING':
      if (!s.trialEndsAt) return now;
      return s.trialEndsAt <= now ? s.trialEndsAt : null;
    case 'ACTIVE': {
      if (!s.currentPeriodEnd) return null;
      if (s.cancelAtPeriodEnd) return s.currentPeriodEnd <= now ? s.currentPeriodEnd : null;
      // Renewing: give the renewal a few days to arrive.
      const due = new Date(s.currentPeriodEnd.getTime() + RENEWAL_TOLERANCE_DAYS * DAY);
      return due <= now ? s.currentPeriodEnd : null;
    }
    case 'PAST_DUE':
      // A renewal charge failed. Access runs to the end of the paid period.
      if (s.currentPeriodEnd && s.currentPeriodEnd > now) return null;
      return s.currentPeriodEnd ?? now;
    case 'CANCELED':
      if (s.currentPeriodEnd && s.currentPeriodEnd > now) return null;
      return s.currentPeriodEnd ?? now;
    case 'INCOMPLETE':
      return now;
  }
}

export interface AccessResolution {
  state: AccessState;
  trialEndsAt: Date | null;
  /** when grace ends (grace and lapsed only) */
  graceEndsAt: Date | null;
  /**
   * A lapse found now but not yet stored. The caller writes it, once, so the
   * deadline is fixed from this moment on.
   */
  toRecord: { lapsedAt: Date; graceEndsAt: Date } | null;
}

export function resolveAccess(s: SubscriptionFacts | null, now: Date, graceDays: number): AccessResolution {
  if (!s) return { state: 'none', trialEndsAt: null, graceEndsAt: null, toRecord: null };

  // A lapse already recorded keeps its own deadline.
  if (s.lapsedAt && s.graceEndsAt) {
    return {
      state: now < s.graceEndsAt ? 'grace' : 'lapsed',
      trialEndsAt: s.trialEndsAt,
      graceEndsAt: s.graceEndsAt,
      toRecord: null,
    };
  }

  const ended = accessEndedAt(s, now);
  if (!ended) {
    return { state: s.status === 'TRIALING' ? 'trial' : 'active', trialEndsAt: s.trialEndsAt, graceEndsAt: null, toRecord: null };
  }

  const graceEndsAt = new Date(ended.getTime() + Math.max(0, graceDays) * DAY);
  return {
    state: now < graceEndsAt ? 'grace' : 'lapsed',
    trialEndsAt: s.trialEndsAt,
    graceEndsAt,
    toRecord: { lapsedAt: ended, graceEndsAt },
  };
}

/** Whole days left until `date`, never negative ("1 day" on the last day). */
export function daysUntil(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / DAY));
}

/** The storefront sells in every state but `lapsed`. */
export function storefrontOpen(state: AccessState): boolean {
  return state !== 'lapsed';
}

/**
 * The dashboard pages a lapsed workspace can still open: billing, choosing a
 * plan, and the orders customers have already paid for — so they can be
 * dispatched, delivered and refunded (ROADMAP 12.1). Not a new counter sale.
 */
const OPEN_WHILE_LAPSED = ['/settings/billing', '/upgrade', '/sales/orders'];

export function isOpenWhileLapsed(pathname: string): boolean {
  if (pathname === '/sales/orders/new' || pathname.startsWith('/sales/orders/new/')) return false;
  return OPEN_WHILE_LAPSED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

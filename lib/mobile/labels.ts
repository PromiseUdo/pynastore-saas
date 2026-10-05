/*
 * lib/mobile/labels.ts
 *
 * How a store app's order reads, to merchants and staff alike (AGENTS §6: no
 * raw enums). Pure.
 */
export type BadgeVariant = 'draft' | 'pending' | 'processing' | 'info' | 'success' | 'warning' | 'destructive';

export const APP_STAGE: Record<string, { label: string; variant: BadgeVariant }> = {
  REQUESTED: { label: 'Not paid yet', variant: 'draft' },
  PAID: { label: 'Waiting to be built', variant: 'pending' },
  BUILDING: { label: 'Being built', variant: 'processing' },
  DELIVERED: { label: 'Ready to publish', variant: 'info' },
  LIVE: { label: 'Live', variant: 'success' },
};

/** The app's own state — whether it opens — which trumps the stage once it lapses. */
export function appStateBadge(app: { stage: string; status: string; graceEndsAt: Date | null }): { label: string; variant: BadgeVariant } {
  if (app.status === 'LAPSED') return { label: 'Switched off', variant: 'destructive' };
  if (app.graceEndsAt) return { label: 'Renewal overdue', variant: 'warning' };
  return APP_STAGE[app.stage] ?? { label: '—', variant: 'draft' };
}

/** The next step, in a sentence, for the merchant (AGENTS §5). */
export const MERCHANT_NEXT_STEP: Record<string, string> = {
  REQUESTED: 'Pay to send us your request. We start building as soon as it arrives.',
  PAID: 'We’ve got your request and will start building your app shortly.',
  BUILDING: 'We’re building your app. We’ll email you when it’s ready.',
  DELIVERED: 'Your app is ready. Publish it from your Apple and Google accounts — the steps are below.',
  LIVE: 'Your app is in the stores.',
};

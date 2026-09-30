/*
 * lib/ops/webhooks.ts
 *
 * Watching the doors other services knock on (ROADMAP 13.3): the Paystack
 * webhook and the Meta (Facebook/Instagram) sign-in callback. Squad is
 * retired (10.9).
 *
 * Every failure goes into the error log (source "webhook"). Several within
 * WINDOW_MINUTES emails staff — once, then at most every 6 hours while it
 * keeps failing — and the next success says it's working again.
 *
 * A failure here means something is wrong on OUR side or between us: a bad
 * signature (the wrong secret, or live/test keys mixed), an event we
 * couldn't process, a token exchange Meta refused. A merchant pressing
 * Cancel on Meta's dialog is not a failure.
 */
import { prisma } from '@/lib/prisma';
import { claimAlert, clearAlerts, sendStaffAlert } from './alerts';
import { errorLogEnabled, recordError } from './errors';

export const WEBHOOKS = {
  paystack: {
    title: 'Paystack webhook',
    affects: 'Payments shoppers make may not be confirmed, and subscription changes may not reach the platform.',
  },
  'meta-callback': {
    title: 'Facebook and Instagram connection',
    affects: 'Merchants can’t connect their Facebook Page or Instagram account.',
  },
} as const;

export type WebhookName = keyof typeof WEBHOOKS;

const WINDOW_MINUTES = 30;
const FAILURES_TO_ALERT = 3;

export async function webhookFailed(
  name: WebhookName,
  failure: { kind: string; message: string; error?: unknown; path?: string },
): Promise<void> {
  const err = failure.error instanceof Error ? failure.error : null;
  await recordError({
    source: 'webhook',
    where: name,
    kind: failure.kind,
    message: failure.message,
    stack: err?.stack ?? null,
    path: failure.path ?? null,
  });
  // Like the error log itself: alerts come from the live site only.
  if (!errorLogEnabled()) return;
  try {
    const recent = await prisma.errorEvent.count({
      where: {
        occurredAt: { gt: new Date(Date.now() - WINDOW_MINUTES * 60_000) },
        group: { source: 'webhook', where: name },
      },
    });
    if (recent < FAILURES_TO_ALERT || !(await claimAlert(`webhook:${name}`, 'failed'))) return;
    const hook = WEBHOOKS[name];
    await sendStaffAlert({
      subject: `${hook.title} is failing`,
      heading: `The ${hook.title.toLowerCase()} failed ${recent} times in the last ${WINDOW_MINUTES} minutes`,
      paragraphs: [
        hook.affects,
        `The latest: ${failure.message}`,
        failure.kind === 'signature'
          ? 'Most often this is the wrong secret key in the environment variables, or live and test keys mixed up. It can also be someone probing the address.'
          : 'The error log has each failure with its details.',
      ],
      button: { label: 'Open the error log', path: '/platform/errors?source=webhook' },
    });
  } catch {
    // The error itself is already recorded; the alert is best effort.
  }
}

/** A success: if staff were told it was failing, tell them it isn't any more. */
export async function webhookSucceeded(name: WebhookName): Promise<void> {
  if (!errorLogEnabled()) return;
  try {
    if ((await clearAlerts(`webhook:${name}`, ['failed'])) === 0) return;
    const hook = WEBHOOKS[name];
    await sendStaffAlert({
      subject: `Working again: ${hook.title}`,
      heading: `The ${hook.title.toLowerCase()} is working again`,
      paragraphs: ['It has just handled a request without a problem. No more alerts will be sent about it unless it breaks again.'],
      button: { label: 'Open the error log', path: '/platform/errors?source=webhook' },
    });
  } catch {
    // best effort
  }
}

/*
 * lib/ops/go-live.ts
 *
 * The console's go-live checklist (ROADMAP 13.9): the settings and outside
 * accounts a live launch depends on, checked against THIS server's
 * environment and database. Pure — `goLiveChecks` takes the environment and
 * a few facts read elsewhere — so it can be tested, and it never returns a
 * secret, only whether one is there and well-formed.
 *
 * What can't be checked from here (Meta's App Review, Resend's domain
 * verification, the app-store listings) is listed as steps to confirm by
 * hand; docs/GO-LIVE.md walks through each.
 */

export type CheckStatus = 'ok' | 'action' | 'manual';

export interface GoLiveCheck {
  id: string;
  group: 'Payments' | 'Email' | 'Social' | 'Platform';
  title: string;
  status: CheckStatus;
  /** what we found, in plain words — never a secret's value */
  detail: string;
}

export interface GoLiveFacts {
  /** the last Paystack webhook we received, if any */
  lastWebhook: { at: string; mode: string | null } | null;
  /** verified merchants whose payout subaccount isn't in the current key's mode */
  payoutsToMove: number;
  /** the callback address Meta must have on file */
  expectedMetaRedirect: string;
  now: Date;
}

type Env = Record<string, string | undefined>;

const has = (env: Env, key: string) => Boolean(env[key]?.trim());

export function goLiveChecks(env: Env, facts: GoLiveFacts): GoLiveCheck[] {
  const checks: GoLiveCheck[] = [];
  const key = env.PAYSTACK_SECRET_KEY?.trim() ?? '';
  const keyMode = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : null;
  const declared = env.PAYSTACK_MODE?.trim();

  // ── Payments ──
  checks.push({
    id: 'paystack-key',
    group: 'Payments',
    title: 'Paystack live key',
    ...(keyMode === 'live' && declared === 'live'
      ? { status: 'ok' as const, detail: 'A live secret key is set, and PAYSTACK_MODE says live.' }
      : !key
        ? { status: 'action' as const, detail: 'PAYSTACK_SECRET_KEY isn’t set.' }
        : keyMode === 'test'
          ? { status: 'action' as const, detail: 'The secret key is a TEST key (sk_test_…). Shoppers can’t pay real money until it’s the live one.' }
          : keyMode === null
            ? { status: 'action' as const, detail: 'PAYSTACK_SECRET_KEY doesn’t look like a Paystack secret key.' }
            : { status: 'action' as const, detail: `The key is live, but PAYSTACK_MODE is ${declared ? `“${declared}”` : 'not set'}. Set PAYSTACK_MODE=live — with a mismatch, payments are switched off on purpose.` }),
  });

  const hook = facts.lastWebhook;
  const hookAge = hook ? (facts.now.getTime() - new Date(hook.at).getTime()) / 86_400_000 : null;
  checks.push({
    id: 'paystack-webhook',
    group: 'Payments',
    title: 'Paystack webhook',
    ...(!hook
      ? { status: 'action' as const, detail: 'No event from Paystack has reached us yet. Set the webhook URL in Paystack’s dashboard, then make a payment.' }
      : keyMode === 'live' && hook.mode !== 'live'
        ? { status: 'action' as const, detail: `The last event was a ${hook.mode ?? 'unknown'}-mode one. Set the webhook URL on Paystack’s LIVE settings too, then make a live payment.` }
        : { status: 'ok' as const, detail: `Last event received ${hookAge !== null && hookAge < 1 ? 'today' : `${Math.round(hookAge ?? 0)} days ago`}, ${hook.mode ?? 'mode unknown'}.` }),
  });

  checks.push({
    id: 'payouts',
    group: 'Payments',
    title: 'Merchants’ payout accounts',
    ...(facts.payoutsToMove === 0
      ? { status: 'ok' as const, detail: `Every approved business has a payout account in ${keyMode ?? 'the current'} mode.` }
      : {
          status: 'action' as const,
          detail: `${facts.payoutsToMove} approved ${facts.payoutsToMove === 1 ? 'business doesn’t have a payout account' : 'businesses don’t have payout accounts'} that work${facts.payoutsToMove === 1 ? 's' : ''} with this key — missing, or made in ${keyMode === 'live' ? 'test' : 'the other'} mode, which this key can’t see. Their shoppers can’t pay online until it’s set up — use the button below.`,
        }),
  });

  // ── Email ──
  const from = env.EMAIL_FROM?.trim() ?? '';
  const fromDomain = from.match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase() ?? '';
  checks.push({
    id: 'email',
    group: 'Email',
    title: 'Sending address',
    ...(!has(env, 'RESEND_API_KEY')
      ? { status: 'action' as const, detail: 'RESEND_API_KEY isn’t set, so no email can be sent.' }
      : !from
        ? { status: 'action' as const, detail: 'EMAIL_FROM isn’t set.' }
        : fromDomain === 'resend.dev' || fromDomain.endsWith('example.com') || !fromDomain
          ? { status: 'action' as const, detail: `EMAIL_FROM (${from}) isn’t on your own domain, so mail only reaches you, or lands in spam.` }
          : { status: 'ok' as const, detail: `Emails are sent from ${from}. Confirm ${fromDomain} shows “Verified” in Resend.` }),
  });

  // ── Social ──
  const socialKey = env.SOCIAL_TOKEN_KEY?.trim();
  const socialKeyBytes = socialKey ? Buffer.from(socialKey, 'base64').length : 0;
  checks.push({
    id: 'social-key',
    group: 'Social',
    title: 'Encryption key for social accounts',
    ...(!socialKey
      ? { status: 'action' as const, detail: 'SOCIAL_TOKEN_KEY isn’t set, so the key is derived from AUTH_SECRET — rotating AUTH_SECRET would disconnect every merchant’s Facebook and Instagram. Set it as docs/GO-LIVE.md describes (it keeps today’s connections).' }
      : socialKeyBytes !== 32
        ? { status: 'action' as const, detail: `SOCIAL_TOKEN_KEY must be 32 bytes of base64; this one is ${socialKeyBytes}. Connecting social accounts will fail until it’s fixed.` }
        : { status: 'ok' as const, detail: 'Set, and the right length.' }),
  });

  const redirect = env.META_REDIRECT_URI?.trim() || facts.expectedMetaRedirect;
  checks.push({
    id: 'meta-app',
    group: 'Social',
    title: 'Meta app settings',
    ...(!has(env, 'META_APP_ID') || !has(env, 'META_APP_SECRET')
      ? { status: 'action' as const, detail: 'META_APP_ID or META_APP_SECRET isn’t set, so merchants can’t connect Facebook or Instagram.' }
      : !redirect.startsWith('https://')
        ? { status: 'action' as const, detail: `The callback address (${redirect}) isn’t https; Meta refuses it for a live app.` }
        : { status: 'ok' as const, detail: `Set. Meta must list ${redirect} as a valid OAuth redirect URI.` }),
  });

  // ── Platform ──
  const authSecret = env.AUTH_SECRET?.trim() ?? '';
  checks.push({
    id: 'auth-secret',
    group: 'Platform',
    title: 'Sign-in secret',
    ...(authSecret.length >= 32
      ? { status: 'ok' as const, detail: 'AUTH_SECRET is set and long enough.' }
      : { status: 'action' as const, detail: 'AUTH_SECRET is missing or shorter than 32 characters. Generate one with `openssl rand -base64 32`.' }),
  });
  checks.push({
    id: 'migrations',
    group: 'Platform',
    title: 'Migrations on deploy',
    ...(has(env, 'DIRECT_URL')
      ? { status: 'ok' as const, detail: 'DIRECT_URL is set, so each production deploy applies its database changes.' }
      : { status: 'action' as const, detail: 'DIRECT_URL isn’t set: deploys won’t apply database changes, and they’d have to be run by hand (docs/DATABASE.md).' }),
  });
  checks.push({
    id: 'cron',
    group: 'Platform',
    title: 'Scheduled jobs',
    ...(has(env, 'CRON_SECRET')
      ? { status: 'ok' as const, detail: 'CRON_SECRET is set. Console → Scheduled jobs shows whether each one is running.' }
      : { status: 'action' as const, detail: 'CRON_SECRET isn’t set, so no scheduler can run the jobs (unpaid orders, reminders, data retention).' }),
  });
  checks.push({
    id: 'alerts',
    group: 'Platform',
    title: 'Staff alerts',
    ...(has(env, 'PLATFORM_ADMIN_EMAIL')
      ? { status: 'ok' as const, detail: `Errors, failing jobs and webhooks are emailed to ${env.PLATFORM_ADMIN_EMAIL}.` }
      : { status: 'action' as const, detail: 'PLATFORM_ADMIN_EMAIL isn’t set, so nobody is told when something breaks.' }),
  });
  checks.push({
    id: 'uploads',
    group: 'Platform',
    title: 'Image uploads',
    ...(has(env, 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME') && has(env, 'NEXT_PUBLIC_CLOUDINARY_API_KEY') && has(env, 'CLOUDINARY_API_SECRET')
      ? { status: 'ok' as const, detail: 'Cloudinary is configured.' }
      : { status: 'action' as const, detail: 'Cloudinary isn’t fully configured, so merchants can’t upload product photos.' }),
  });

  return checks;
}

/** What only a person can confirm, with where to do it — the steps in docs/GO-LIVE.md. */
export const MANUAL_STEPS: { id: string; group: GoLiveCheck['group'] | 'Mobile app' | 'Legal'; title: string; detail: string }[] = [
  { id: 'meta-review', group: 'Social', title: 'Meta App Review approved', detail: 'Advanced Access granted for the six permissions, and the app switched to Live mode — until then only testers can connect.' },
  { id: 'resend-domain', group: 'Email', title: 'Sending domain verified in Resend', detail: 'The domain in EMAIL_FROM shows “Verified” under Resend → Domains.' },
  { id: 'paystack-live', group: 'Payments', title: 'A real payment, end to end', detail: 'One small live order paid with a real card, the order marked paid, and the money arriving in the merchant’s bank account.' },
  { id: 'app-store', group: 'Mobile app', title: 'App Store listing and privacy answers', detail: 'App Store Connect: listing, screenshots, privacy policy link and the App Privacy questions answered.' },
  { id: 'play-store', group: 'Mobile app', title: 'Google Play listing and Data safety form', detail: 'Play Console: listing, screenshots, privacy policy link and the Data safety form answered.' },
  { id: 'counsel', group: 'Legal', title: 'Terms and privacy reviewed by counsel (10.10)', detail: 'Including the 6-year retention and 30-day closing rules (lib/data-rights/policy.ts).' },
];

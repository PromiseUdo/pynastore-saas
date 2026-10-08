/*
 * lib/cron/jobs.ts
 *
 * Every scheduled job, in one place (ROADMAP 13.1): what it's called in the
 * console, what it does in plain words, how often something is meant to call
 * it, and the work itself. The routes under app/api/cron/ and the console's
 * "Run now" both go through runCronJob (./run.ts) with a key from here.
 *
 * Who calls them: the daily two from vercel.json (Vercel Cron); the two that
 * run every 15 minutes from cron-job.org while the project is on Vercel's
 * Hobby plan, which only allows daily cron jobs. On Pro, add those two to
 * vercel.json and switch cron-job.org off — nothing here changes.
 * docs/SCHEDULED-JOBS.md has the setup.
 */
import { expireUnpaidOrders } from '@/lib/storefront/orders/lifecycle';
import { indexPendingImages, queueUnindexedImages } from '@/lib/storefront/visual-search/indexing';
import { purgeExpiredQueries } from '@/lib/storefront/visual-search/vector-store';
import { runDomainLifecycle } from '@/lib/domains/lifecycle';
import { runOnboardingReminders } from '@/lib/onboarding/reminders';
import { runDataRetention } from '@/lib/data-rights/retention';
import { runMobileAppRenewals } from '@/lib/mobile/renewals';

export interface CronJob {
  title: string;
  /** What it does and what goes wrong without it, for staff. */
  description: string;
  /** How often it's meant to run, in words. */
  schedule: string;
  /** How often, in minutes — what "hasn't run when it should" is measured against. */
  everyMinutes: number;
  run: () => Promise<unknown>;
  /** What a run reported, in a few words for the console ("Released 2 unpaid orders"). */
  describe: (result: Counts) => string;
}

/** A run's reported numbers, as stored — read defensively, since old rows may lack a field. */
export type Counts = Record<string, unknown>;

const n = (r: Counts, key: string): number => (typeof r[key] === 'number' ? (r[key] as number) : 0);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const CRON_JOBS = {
  'expire-unpaid-orders': {
    title: 'Release unpaid orders',
    description:
      'Cancels online orders nobody paid for within the hold time and puts their stock back on sale. Without it, a quiet store can show items as sold out that nobody bought.',
    schedule: 'Every 15 minutes',
    everyMinutes: 15,
    run: () => expireUnpaidOrders({ limit: 200 }),
    describe: (r) =>
      n(r, 'checked') === 0
        ? 'No unpaid orders past their hold'
        : `Released ${plural(n(r, 'expired'), 'unpaid order', 'unpaid orders')} of ${n(r, 'checked')} past their hold`,
  },
  'index-product-images': {
    title: 'Index photos for search by image',
    description:
      'Indexes product photos a save couldn’t finish, retries failures, and deletes shoppers’ search photos after 24 hours. Without it, some products can’t be found by photo.',
    schedule: 'Every 15 minutes',
    everyMinutes: 15,
    run: async () => {
      const queued = await queueUnindexedImages(200);
      const result = await indexPendingImages({ limit: 25 });
      const purgedQueries = await purgeExpiredQueries();
      return { queued, ...result, purgedQueries };
    },
    describe: (r) =>
      [
        `${plural(n(r, 'indexed') + n(r, 'reused'), 'photo', 'photos')} indexed`,
        n(r, 'failed') ? `${n(r, 'failed')} failed` : null,
        n(r, 'deferred') ? `${n(r, 'deferred')} left for later` : null,
        n(r, 'purgedQueries') ? `${plural(n(r, 'purgedQueries'), 'old search photo', 'old search photos')} deleted` : null,
      ]
        .filter(Boolean)
        .join(' · '),
  },
  'domain-lifecycle': {
    title: 'Domain renewals',
    description:
      'Sends merchants their domain renewal reminders, stops domains that weren’t renewed, and emails staff the domains due in the next 14 days.',
    schedule: 'Daily at 8am Lagos time',
    everyMinutes: 24 * 60,
    run: () => runDomainLifecycle(),
    describe: (r) =>
      [
        `${plural(n(r, 'reminders'), 'reminder', 'reminders')} sent`,
        n(r, 'expired') ? `${plural(n(r, 'expired'), 'domain', 'domains')} stopped` : null,
        n(r, 'failed') ? `${n(r, 'failed')} couldn’t be sent` : null,
        r.digest === true ? 'staff list sent' : null,
      ]
        .filter(Boolean)
        .join(' · '),
  },
  'mobile-app-renewals': {
    title: 'Store app renewals',
    description:
      'Reminds merchants before their store app’s paid year ends, starts the grace period when it ends unpaid, and switches the app off when the grace runs out. Without it, apps keep working unpaid and nobody is reminded.',
    schedule: 'Daily at 8:30am Lagos time',
    everyMinutes: 24 * 60,
    run: () => runMobileAppRenewals(),
    describe: (r) =>
      [
        `${plural(n(r, 'reminders'), 'reminder', 'reminders')} sent`,
        n(r, 'inGrace') ? `${plural(n(r, 'inGrace'), 'app', 'apps')} into grace` : null,
        n(r, 'lapsed') ? `${plural(n(r, 'lapsed'), 'app', 'apps')} switched off` : null,
        n(r, 'failed') ? `${n(r, 'failed')} failed` : null,
      ]
        .filter(Boolean)
        .join(' · '),
  },
  'onboarding-reminders': {
    title: 'Setup and trial reminders',
    description:
      'Sends new merchants their “finish setting up” nudges on days 3 and 7, and the “your trial ends soon” emails 3 days and 1 day before.',
    schedule: 'Daily at 9am Lagos time',
    everyMinutes: 24 * 60,
    run: () => runOnboardingReminders(),
    describe: (r) =>
      [`${plural(n(r, 'sent'), 'reminder', 'reminders')} sent`, n(r, 'failed') ? `${n(r, 'failed')} couldn’t be sent` : null]
        .filter(Boolean)
        .join(' · '),
  },
  'data-retention': {
    title: 'Data retention',
    description:
      'Carries out the retention rules: clears closed shops after 30 days, erases them after 6 years, and removes deleted shoppers’ details from records past 6 years, and removes guest chats nobody has written in for a year. Without it, data is kept longer than the privacy policy says.',
    schedule: 'Daily at 4am Lagos time',
    everyMinutes: 24 * 60,
    run: () => runDataRetention(),
    describe: (r) =>
      [
        n(r, 'workspacesPurged') ? `${plural(n(r, 'workspacesPurged'), 'closed shop', 'closed shops')} cleared` : null,
        n(r, 'workspacesErased') ? `${plural(n(r, 'workspacesErased'), 'shop', 'shops')} erased` : null,
        n(r, 'ordersAnonymized') ? `${plural(n(r, 'ordersAnonymized'), 'order', 'orders')} anonymised` : null,
        n(r, 'customersAnonymized') ? `${plural(n(r, 'customersAnonymized'), 'customer', 'customers')} anonymised` : null,
        n(r, 'guestChatsRemoved') ? `${plural(n(r, 'guestChatsRemoved'), 'old guest chat', 'old guest chats')} removed` : null,
        n(r, 'pushWatchesRemoved') ? `${plural(n(r, 'pushWatchesRemoved'), 'order notification', 'order notifications')} ended` : null,
        n(r, 'failed') ? `${n(r, 'failed')} failed` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing due',
  },
} satisfies Record<string, CronJob>;

export type CronJobKey = keyof typeof CRON_JOBS;

export const CRON_JOB_KEYS = Object.keys(CRON_JOBS) as CronJobKey[];

export function isCronJobKey(key: string): key is CronJobKey {
  return Object.hasOwn(CRON_JOBS, key);
}

/*
 * lib/ops/errors.ts
 *
 * The error log (ROADMAP 13.3). Everything that goes wrong ends up here:
 *   - server errors, from Next.js itself (instrumentation.ts → onRequestError);
 *   - browser errors, reported by the pages (/api/client-errors);
 *   - webhook failures (lib/ops/webhooks.ts).
 *
 * Each is filed under an ErrorGroup (see error-shape.ts for what counts as
 * "the same error"), with one ErrorEvent per occurrence kept 14 days.
 *
 * Staff hear about it by email (lib/ops/alerts.ts) when:
 *   - a NEW server or webhook error appears (at most 10 such emails an hour —
 *     past that, the console has the rest);
 *   - a resolved error comes back;
 *   - any error spikes: SPIKE_PER_HOUR occurrences within an hour.
 * A browser error alone never emails when new — browsers are noisy — only
 * when it spikes.
 *
 * recordError never throws: the error log failing must not become a second
 * error on top of the first.
 *
 * Only the production deployment writes to it (VERCEL_ENV=production), or
 * anywhere with ERROR_LOG=on — so a developer's mistakes on their own machine
 * don't land in the console or email staff. Elsewhere errors are only logged.
 */
import { prisma } from '@/lib/prisma';
import { takeRateLimits } from '@/lib/rate-limit';
import { claimAlert, sendStaffAlert } from './alerts';
import { log } from './log';
import { fingerprintOf, safePath } from './error-shape';

export type ErrorSource = 'server' | 'client' | 'webhook';

export const SPIKE_PER_HOUR: Record<ErrorSource, number> = { server: 30, webhook: 10, client: 50 };
const NEW_ERROR_EMAILS_PER_HOUR = 10;
const KEEP_EVENTS_DAYS = 14;
const KEEP_GROUPS_DAYS = 90;
const MAX_STACK = 4000;

export interface ErrorReport {
  source: ErrorSource;
  /** Where it happened: a route file, a page's place (ids blanked), or a webhook's name. */
  where: string;
  kind?: string | null;
  message: string;
  stack?: string | null;
  path?: string | null;
  host?: string | null;
  digest?: string | null;
}

export type RecordedError = { groupId: string; isNew: boolean; cameBack: boolean } | null;

export function errorLogEnabled(): boolean {
  if (process.env.ERROR_LOG === 'on') return true;
  if (process.env.ERROR_LOG === 'off') return false;
  return process.env.VERCEL_ENV === 'production';
}

export async function recordError(report: ErrorReport): Promise<RecordedError> {
  if (!errorLogEnabled()) {
    log.error('error.not_recorded', { source: report.source, where: report.where, kind: report.kind, message: report.message?.slice(0, 500) });
    return null;
  }
  try {
    const message = (report.message || 'An error with no message').slice(0, 1000);
    const fingerprint = fingerprintOf(report.source, report.where, message);
    const now = new Date();
    const path = safePath(report.path);
    const details = {
      lastSeenAt: now,
      lastStack: report.stack ? report.stack.slice(0, MAX_STACK) : null,
      lastPath: path,
      lastDigest: report.digest ?? null,
    };

    const before = await prisma.errorGroup.findUnique({ where: { fingerprint }, select: { id: true, resolvedAt: true } });
    const group = before
      ? await prisma.errorGroup.update({
          where: { id: before.id },
          data: { ...details, count: { increment: 1 }, resolvedAt: null, resolvedById: null },
          select: { id: true, message: true, where: true, source: true },
        })
      : await prisma.errorGroup.upsert({
          // upsert, not create: another instance may have filed it a moment ago
          where: { fingerprint },
          create: { fingerprint, source: report.source, where: report.where.slice(0, 300), kind: report.kind ?? null, message, ...details },
          update: { ...details, count: { increment: 1 } },
          select: { id: true, message: true, where: true, source: true },
        });
    await prisma.errorEvent.create({
      data: { groupId: group.id, occurredAt: now, path, host: report.host?.slice(0, 200) ?? null, digest: report.digest ?? null },
    });

    const isNew = !before;
    const cameBack = Boolean(before?.resolvedAt);
    log.error('error.recorded', { source: report.source, where: report.where, kind: report.kind, message, path, groupId: group.id, isNew, cameBack });

    await alertAbout(group, report.source, { isNew, cameBack });
    if (Math.random() < 0.01) await prune();
    return { groupId: group.id, isNew, cameBack };
  } catch (error) {
    log.error('error_log.write_failed', { source: report.source, where: report.where, message: report.message?.slice(0, 200) }, error);
    return null;
  }
}

async function alertAbout(
  group: { id: string; message: string; where: string; source: string },
  source: ErrorSource,
  flags: { isNew: boolean; cameBack: boolean },
) {
  const what = source === 'client' ? 'in a browser' : source === 'webhook' ? 'in a webhook' : 'on the server';
  const lines = [`Where: ${group.where}`, `What it said: ${group.message}`];
  const button = { label: 'Open the error', path: `/platform/errors/${group.id}` };

  if ((flags.isNew && source !== 'client') || flags.cameBack) {
    // A burst of brand-new errors (a bad deploy) sends ten emails, not hundreds.
    const allowed = await takeRateLimits([{ key: 'alerts:new-error', limit: NEW_ERROR_EMAILS_PER_HOUR, windowMs: 3_600_000 }], { onError: 'deny' });
    if (allowed.ok) {
      await sendStaffAlert({
        subject: flags.cameBack ? `Error came back: ${group.message.slice(0, 80)}` : `New error: ${group.message.slice(0, 80)}`,
        heading: flags.cameBack ? `An error marked resolved happened again ${what}` : `A new error ${what}`,
        paragraphs: lines,
        button,
      });
    }
  }

  const lastHour = await prisma.errorEvent.count({ where: { groupId: group.id, occurredAt: { gt: new Date(Date.now() - 3_600_000) } } });
  if (lastHour >= SPIKE_PER_HOUR[source] && (await claimAlert(`error:${group.id}`, 'spike'))) {
    await sendStaffAlert({
      subject: `Error spiking: ${group.message.slice(0, 80)}`,
      heading: `An error happened ${lastHour} times in the last hour ${what}`,
      paragraphs: lines,
      button,
    });
  }
}

async function prune() {
  const eventsBefore = new Date(Date.now() - KEEP_EVENTS_DAYS * 86_400_000);
  const groupsBefore = new Date(Date.now() - KEEP_GROUPS_DAYS * 86_400_000);
  await prisma.errorEvent.deleteMany({ where: { occurredAt: { lt: eventsBefore } } });
  await prisma.errorGroup.deleteMany({ where: { lastSeenAt: { lt: groupsBefore } } });
}

/** For a catch block that handles an error but still wants it on record. */
export async function reportCaughtError(error: unknown, where: string, extra: Partial<ErrorReport> = {}): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  await recordError({ source: 'server', where, kind: 'caught', message: err.message, stack: err.stack, ...extra });
}

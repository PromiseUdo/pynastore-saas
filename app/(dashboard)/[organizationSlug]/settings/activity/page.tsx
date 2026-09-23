/*
 * Settings → Activity.
 *
 * Who did what in this workspace. Every mutation already writes an audit row
 * (lib/audit.ts) — this is where they can finally be read, which is what
 * matters once a merchant has more than one person signing in.
 *
 * Filters and the page number live in the URL (AGENTS §3) and become Prisma
 * `where` clauses; nothing is filtered in the browser.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { listActivity, type ActivityFilters } from '@/features/settings/activity';
import { ActivityClient } from './_components/ActivityClient';

export const metadata: Metadata = { title: 'Activity' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/** A date from the URL, or undefined — never an Invalid Date in a query. */
function day(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Reads the URL into filters. Nothing here can widen what comes back: the
 * organization is added from the session, and every value that survives only
 * narrows the query.
 */
function parseParams(raw: Record<string, string | string[] | undefined>): ActivityFilters {
  const page = Number(one(raw.page));
  return {
    memberId: one(raw.member),
    area: one(raw.area),
    q: one(raw.q),
    from: day(one(raw.from)),
    to: day(one(raw.to), true),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW)) {
    return <AccessDenied what="activity" />;
  }

  const filters = parseParams(await searchParams);
  const result = await listActivity(filters);
  if (!result.success) throw new Error(result.error);

  return <ActivityClient result={result.data} />;
}

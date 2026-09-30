'use server';

/*
 * features/platform/errors.ts
 *
 * The error log, for platform staff (ROADMAP 13.3): what went wrong, where,
 * how often, and marking it resolved once fixed. Filled by lib/ops/errors.ts.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { requirePlatformStaff } from '@/lib/platform-staff';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };
export type ErrorStatusFilter = 'open' | 'resolved' | 'all';
export type ErrorSourceFilter = 'all' | 'server' | 'client' | 'webhook';

const PAGE_SIZE = 25;
const DAY = 86_400_000;

export interface ErrorRow {
  id: string;
  source: 'server' | 'client' | 'webhook';
  where: string;
  kind: string | null;
  message: string;
  count: number;
  last24h: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolved: boolean;
}

export interface ErrorsPage {
  rows: ErrorRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { open: number };
}

export interface ErrorDetail extends ErrorRow {
  lastStack: string | null;
  lastPath: string | null;
  lastDigest: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  lastHour: number;
  last14d: number;
  events: { id: string; occurredAt: string; path: string | null; host: string | null; digest: string | null }[];
}

function asSource(value: string): ErrorRow['source'] {
  return value === 'client' || value === 'webhook' ? value : 'server';
}

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') return { success: false, error: 'Not allowed.' };
  console.error('[platform/errors]', error);
  return { success: false, error: fallback };
}

/** For the console nav and overview: open errors that happened in the last 24 hours. */
export async function errorsAttentionCount(): Promise<number> {
  try {
    await requirePlatformStaff();
    return await prisma.errorGroup.count({ where: { resolvedAt: null, lastSeenAt: { gt: new Date(Date.now() - DAY) } } });
  } catch {
    return 0;
  }
}

export async function listErrors(params: {
  status?: ErrorStatusFilter;
  source?: ErrorSourceFilter;
  q?: string;
  page?: number;
}): Promise<ActionResult<ErrorsPage>> {
  try {
    await requirePlatformStaff();
    const status = params.status ?? 'open';
    const source = params.source ?? 'all';
    const q = params.q?.trim().slice(0, 100) ?? '';
    const page = Math.max(1, Math.floor(params.page ?? 1));

    const where: Prisma.ErrorGroupWhereInput = {
      ...(status === 'open' ? { resolvedAt: null } : status === 'resolved' ? { resolvedAt: { not: null } } : {}),
      ...(source !== 'all' ? { source } : {}),
      ...(q
        ? { OR: [{ message: { contains: q, mode: 'insensitive' } }, { where: { contains: q, mode: 'insensitive' } }] }
        : {}),
    };

    const [groups, total, open] = await Promise.all([
      prisma.errorGroup.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: { id: true, source: true, where: true, kind: true, message: true, count: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true },
      }),
      prisma.errorGroup.count({ where }),
      prisma.errorGroup.count({ where: { resolvedAt: null } }),
    ]);

    const recent = groups.length
      ? await prisma.errorEvent.groupBy({
          by: ['groupId'],
          where: { groupId: { in: groups.map((g) => g.id) }, occurredAt: { gt: new Date(Date.now() - DAY) } },
          _count: { _all: true },
        })
      : [];
    const last24h = new Map(recent.map((r) => [r.groupId, r._count._all]));

    return {
      success: true,
      data: {
        rows: groups.map((g) => ({
          id: g.id,
          source: asSource(g.source),
          where: g.where,
          kind: g.kind,
          message: g.message,
          count: g.count,
          last24h: last24h.get(g.id) ?? 0,
          firstSeenAt: g.firstSeenAt.toISOString(),
          lastSeenAt: g.lastSeenAt.toISOString(),
          resolved: g.resolvedAt !== null,
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
        counts: { open },
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the error log.');
  }
}

export async function getErrorDetail(id: string): Promise<ActionResult<ErrorDetail | null>> {
  try {
    await requirePlatformStaff();
    const group = await prisma.errorGroup.findUnique({ where: { id } });
    if (!group) return { success: true, data: null };

    const now = Date.now();
    const count = (since: number) => prisma.errorEvent.count({ where: { groupId: id, occurredAt: { gt: new Date(now - since) } } });
    const [lastHour, last24h, last14d, events, resolver] = await Promise.all([
      count(3_600_000),
      count(DAY),
      count(14 * DAY),
      prisma.errorEvent.findMany({ where: { groupId: id }, orderBy: { occurredAt: 'desc' }, take: 25 }),
      group.resolvedById ? prisma.user.findUnique({ where: { id: group.resolvedById }, select: { name: true, email: true } }) : null,
    ]);

    return {
      success: true,
      data: {
        id: group.id,
        source: asSource(group.source),
        where: group.where,
        kind: group.kind,
        message: group.message,
        count: group.count,
        last24h,
        firstSeenAt: group.firstSeenAt.toISOString(),
        lastSeenAt: group.lastSeenAt.toISOString(),
        resolved: group.resolvedAt !== null,
        lastStack: group.lastStack,
        lastPath: group.lastPath,
        lastDigest: group.lastDigest,
        resolvedAt: group.resolvedAt?.toISOString() ?? null,
        resolvedBy: resolver ? (resolver.name ?? resolver.email) : null,
        lastHour,
        last14d,
        events: events.map((e) => ({ id: e.id, occurredAt: e.occurredAt.toISOString(), path: e.path, host: e.host, digest: e.digest })),
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load that error.');
  }
}

/** Fixed, or not worth fixing: out of the open list until it happens again. */
export async function resolveError(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const updated = await prisma.errorGroup.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: staff.userId },
    });
    if (updated.count === 0) return { success: false, error: 'It’s already resolved, or no longer exists.' };
    await prisma.opsAlert.deleteMany({ where: { subject: `error:${id}` } });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t mark it resolved.');
  }
}

export async function reopenError(id: string): Promise<ActionResult> {
  try {
    await requirePlatformStaff();
    const updated = await prisma.errorGroup.updateMany({ where: { id, resolvedAt: { not: null } }, data: { resolvedAt: null, resolvedById: null } });
    if (updated.count === 0) return { success: false, error: 'It’s already open, or no longer exists.' };
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t reopen it.');
  }
}

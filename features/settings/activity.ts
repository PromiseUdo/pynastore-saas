'use server';

/*
 * features/settings/activity.ts
 *
 * Settings → Activity: who did what in this workspace.
 *
 * Every mutation in the app already writes an AuditLog row (lib/audit.ts).
 * Until now nothing could read them back — which is the whole point of
 * keeping them once a merchant has staff.
 *
 * Filters, search and the page number are applied by the database, never in
 * the browser (AGENTS §3): a busy store writes thousands of these, and the
 * list is the one place where downloading them all would be worst.
 *
 * Viewing needs `settings.view`. Downloading is a paid feature
 * (FEATURES.AUDIT_LOG_EXPORT) and is re-checked here, not only in the UI.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { isAuditArea } from '@/lib/audit-labels';
import type { Prisma, OrganizationPlan } from '@/lib/generated/prisma/client';

const PER_PAGE = 25;

/* A spreadsheet, not a data warehouse. Past this the answer is a filter, not
 * a bigger file — and the browser has to hold every row to write it. */
const EXPORT_LIMIT = 5000;

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  /** null when the app itself did it — a webhook, or a scheduled job. */
  actorName: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
}

export interface ActivityMember {
  id: string;
  name: string;
  email: string;
}

export interface ActivityFilters {
  memberId?: string;
  area?: string;
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
}

export interface ActivityResult {
  rows: ActivityRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** Rows before any filter — tells "nothing yet" apart from "your filters hid it". */
  historySize: number;
  members: ActivityMember[];
  canExport: boolean;
  exportLimit: number;
}

function whereFor(organizationId: string, filters: ActivityFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { organizationId };

  if (filters.memberId) where.userId = filters.memberId;
  /* Areas are action prefixes ("sales" matches "sales.invoice.voided"). The
   * dot matters: without it "role" would also catch nothing useful and
   * "sale" would catch "sales". */
  if (isAuditArea(filters.area)) where.action = { startsWith: `${filters.area}.` };

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  /* People search this by pasting a record's id out of a URL, so that is
   * what it matches — plus the action key, which is what a developer looking
   * at the same screen would type. */
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { entityId: { contains: q, mode: 'insensitive' } },
      { action: { contains: q, mode: 'insensitive' } },
      { entityType: { contains: q, mode: 'insensitive' } },
    ];
  }

  return where;
}

function toRow(log: {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  ipAddress: string | null;
  user: { name: string | null; email: string } | null;
}): ActivityRow {
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    createdAt: log.createdAt.toISOString(),
    actorName: log.user?.name ?? null,
    actorEmail: log.user?.email ?? null,
    ipAddress: log.ipAddress,
  };
}

const ROW_SELECT = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  createdAt: true,
  ipAddress: true,
  user: { select: { name: true, email: true } },
} as const;

export async function listActivity(filters: ActivityFilters = {}): Promise<ActionResult<ActivityResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);

    const organizationId = ctx.organization.id;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const where = whereFor(organizationId, filters);

    const [rows, total, historySize, memberships] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
        select: ROW_SELECT,
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.count({ where: { organizationId } }),
      prisma.membership.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
    ]);

    return {
      success: true,
      data: {
        rows: rows.map(toRow),
        total,
        page,
        perPage: PER_PAGE,
        pageCount: Math.max(1, Math.ceil(total / PER_PAGE)),
        historySize,
        members: memberships.map((m) => ({
          id: m.user.id,
          name: m.user.name ?? m.user.email,
          email: m.user.email,
        })),
        canExport: hasFeature(ctx.organization.plan as OrganizationPlan, FEATURES.AUDIT_LOG_EXPORT),
        exportLimit: EXPORT_LIMIT,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return { success: false, error: 'You don’t have permission to view activity' };
    }
    console.error('[settings] Failed to load activity:', error);
    return { success: false, error: 'We couldn’t load your activity' };
  }
}

/**
 * The same rows the filters are showing, for the spreadsheet — not just the
 * page on screen, which is what a "download what I'm looking at" button
 * would otherwise give.
 */
export async function exportActivity(filters: ActivityFilters = {}): Promise<ActionResult<ActivityRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);

    if (!hasFeature(ctx.organization.plan as OrganizationPlan, FEATURES.AUDIT_LOG_EXPORT)) {
      return { success: false, error: 'Downloading the activity log is available on the Pro plan' };
    }

    const rows = await prisma.auditLog.findMany({
      where: whereFor(ctx.organization.id, filters),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      select: ROW_SELECT,
    });

    return { success: true, data: rows.map(toRow) };
  } catch (error) {
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return { success: false, error: 'You don’t have permission to view activity' };
    }
    console.error('[settings] Failed to export activity:', error);
    return { success: false, error: 'We couldn’t prepare your download' };
  }
}

'use server';

/*
 * features/platform/merchants.ts
 *
 * Merchants in the platform console (ROADMAP 11.2), and suspending or
 * restoring one (11.4). Platform staff only; every function checks.
 *
 * Like the verification queue, this acts on an organization named by id
 * without pairing it with the caller's own — acting across merchants is the
 * point. What stops misuse is the staff check and the audit entry each
 * suspension leaves on the merchant's own activity log.
 *
 * The plan state (trial, paying, grace, closed) is worked out by the same
 * rule the merchant is held to (lib/billing/access.ts) and is not a column,
 * so the list filters it after reading the cheap columns, then loads the
 * heavier figures — stores, orders, takings — for the one page shown. That
 * is fine to thousands of workspaces; past that it wants a stored state.
 * Nothing here records a lapse.
 */
import { ownerEmails } from '@/lib/org-owners';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { getBillingSettings } from '@/lib/settings';
import { resolveAccess, type AccessState } from '@/lib/billing/access';
import { startOfMonthInLagos } from '@/lib/day';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { sendWorkspaceSuspensionEmail } from '@/lib/email';
import { platformSupportEmail } from '@/lib/platform-contact';
import { getAdminUrl } from '@/lib/tenant/urls';
import { forgetOrgStatus } from '@/lib/tenant/org-status';
import { erasedAt, restorableUntil } from '@/lib/data-rights/policy';
import { restoreClosedWorkspace, WorkspaceClosureError } from '@/lib/data-rights/workspace';
import type { VerificationStatus } from '@/lib/payments/payment-setup';
import { setupProgressFor } from '@/lib/onboarding/setup-guide';
import type { SetupProgress } from '@/lib/onboarding/setup-steps';

/** Where a merchant is with "Get your shop ready" (12.5), as staff see it. */
export interface MerchantSetup {
  isOpen: boolean;
  requiredDone: number;
  requiredTotal: number;
  /** the first step not done — where they may be stuck */
  next: string | null;
}

function setupOf(p: SetupProgress | undefined): MerchantSetup {
  return p
    ? { isOpen: p.isOpen, requiredDone: p.requiredDone, requiredTotal: p.requiredTotal, next: p.next?.title ?? null }
    : { isOpen: false, requiredDone: 0, requiredTotal: 0, next: null };
}

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export type MerchantStatusFilter = 'all' | 'active' | 'suspended' | 'closed';
export type MerchantPlanFilter = 'all' | AccessState;

export interface MerchantRow {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  createdAt: Date;
  ownerEmail: string | null;
  planName: string | null;
  planState: AccessState;
  verificationStatus: VerificationStatus;
  stores: number;
  ordersThisMonth: number;
  /** successful online payments this month, NGN */
  takingsThisMonth: number;
  setup: MerchantSetup;
}

export interface MerchantPage {
  rows: MerchantRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; active: number; suspended: number; closed: number };
}

export interface MerchantDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    createdAt: Date;
    suspendedAt: Date | null;
    suspensionReason: string | null;
    /** closed by its owner (13.8): when, why, whether it can still be restored, and when it's erased */
    closure: { closedAt: Date; reason: string | null; restorableUntil: Date | null; purged: boolean; erasedAt: Date } | null;
    customStoreDomain: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
  };
  plan: {
    name: string | null;
    state: AccessState;
    status: string | null;
    billingCycle: string | null;
    amount: number | null;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    graceEndsAt: Date | null;
  };
  verificationStatus: VerificationStatus;
  setup: MerchantSetup & { steps: { title: string; done: boolean; required: boolean; optional: boolean }[] };
  figures: { stores: number; products: number; ordersThisMonth: number; takingsThisMonth: number; ordersAllTime: number };
  members: { id: string; name: string | null; email: string; role: string; status: string; joinedAt: Date }[];
  transactions: {
    id: string;
    createdAt: Date;
    type: string;
    status: string;
    planName: string | null;
    billingCycle: string | null;
    amount: number;
    reference: string;
  }[];
  domainOrders: { id: string; type: string; domain: string | null; status: string; createdAt: Date; fulfilledAt: Date | null }[];
  /** suspensions and restores, newest first */
  history: { id: string; action: string; staffName: string | null; reason: string | null; createdAt: Date }[];
}

const PAGE_SIZE = 25;

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') {
    return { success: false, error: 'Only platform staff can do this' };
  }
  console.error(`[platform/merchants] ${fallback}:`, error);
  return { success: false, error: fallback };
}

const SUBSCRIPTION_FACTS = {
  status: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  lapsedAt: true,
  graceEndsAt: true,
} as const;

const OWNER = { role: { isSystem: true, name: SYSTEM_ROLES.OWNER.name } } as const;

/** Stores, orders and online takings this month, for a set of workspaces. */
async function figuresFor(ids: string[], now: Date) {
  if (ids.length === 0) return new Map<string, { stores: number; orders: number; takings: number }>();
  const monthStart = startOfMonthInLagos(now);
  const [stores, orders, takings] = await Promise.all([
    prisma.warehouse.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } }),
    prisma.order.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: ids }, placedAt: { gte: monthStart }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    }),
    prisma.orderPayment.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: ids }, status: 'SUCCESS', verifiedAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
  ]);
  return new Map(
    ids.map((id) => [
      id,
      {
        stores: stores.find((s) => s.organizationId === id)?._count._all ?? 0,
        orders: orders.find((o) => o.organizationId === id)?._count._all ?? 0,
        takings: Number(takings.find((t) => t.organizationId === id)?._sum.amount ?? 0),
      },
    ]),
  );
}

/**
 * Workspaces, newest first. Search matches the name, the web address or a
 * member's email; filters are the workspace status and the plan state.
 */
export async function listMerchants(params: {
  q?: string;
  status?: MerchantStatusFilter;
  plan?: MerchantPlanFilter;
  page?: number;
}): Promise<ActionResult<MerchantPage>> {
  try {
    await requirePlatformStaff();
    const now = new Date();
    const status = params.status ?? 'all';
    const plan = params.plan ?? 'all';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const q = params.q?.trim().slice(0, 100);

    const search = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { slug: { contains: q.toLowerCase() } },
            { memberships: { some: { user: { email: { contains: q, mode: 'insensitive' as const } } } } },
          ],
        }
      : {};
    // "All" is the workspaces still trading; a closed one is only under Closed.
    const statusWhere =
      status === 'active'
        ? { status: 'ACTIVE' as const }
        : status === 'suspended'
          ? { status: 'SUSPENDED' as const }
          : status === 'closed'
            ? { status: 'DELETED' as const }
            : { status: { in: ['ACTIVE', 'SUSPENDED'] as ('ACTIVE' | 'SUSPENDED')[] } };

    const [orgs, grouped, { graceDays }] = await Promise.all([
      prisma.organization.findMany({
        where: { ...statusWhere, ...search },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          subscription: { select: { ...SUBSCRIPTION_FACTS, plan: { select: { name: true } } } },
          paymentAccount: { select: { verificationStatus: true } },
        },
      }),
      prisma.organization.groupBy({ by: ['status'], where: search, _count: { _all: true } }),
      getBillingSettings(),
    ]);

    const withState = orgs
      .map((o) => ({ ...o, planState: resolveAccess(o.subscription, now, graceDays).state }))
      .filter((o) => plan === 'all' || o.planState === plan);
    const slice = withState.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const ids = slice.map((o) => o.id);

    const [figures, owners, setups] = await Promise.all([
      figuresFor(ids, now),
      prisma.membership.findMany({
        where: { organizationId: { in: ids }, ...OWNER },
        orderBy: { joinedAt: 'asc' },
        select: { organizationId: true, user: { select: { email: true } } },
      }),
      setupProgressFor(ids),
    ]);

    const active = grouped.find((g) => g.status === 'ACTIVE')?._count._all ?? 0;
    const suspended = grouped.find((g) => g.status === 'SUSPENDED')?._count._all ?? 0;
    const closed = grouped.find((g) => g.status === 'DELETED')?._count._all ?? 0;

    return {
      success: true,
      data: {
        rows: slice.map((o) => {
          const f = figures.get(o.id)!;
          return {
            id: o.id,
            name: o.name,
            slug: o.slug,
            status: o.status as 'ACTIVE' | 'SUSPENDED' | 'DELETED',
            createdAt: o.createdAt,
            ownerEmail: owners.find((m) => m.organizationId === o.id)?.user.email ?? null,
            planName: o.subscription?.plan?.name ?? null,
            planState: o.planState,
            verificationStatus: (o.paymentAccount?.verificationStatus ?? 'UNVERIFIED') as VerificationStatus,
            stores: f.stores,
            ordersThisMonth: f.orders,
            takingsThisMonth: f.takings,
            setup: setupOf(setups.get(o.id)),
          };
        }),
        total: withState.length,
        page,
        pageSize: PAGE_SIZE,
        counts: { all: active + suspended, active, suspended, closed },
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the merchants');
  }
}

export async function getMerchant(organizationId: string): Promise<ActionResult<MerchantDetail | null>> {
  try {
    await requirePlatformStaff();
    const now = new Date();
    const org = await prisma.organization.findFirst({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        suspendedAt: true,
        suspensionReason: true,
        closedAt: true,
        closureReason: true,
        closedDataPurgedAt: true,
        customStoreDomain: true,
        supportEmail: true,
        supportPhone: true,
        subscription: {
          select: { ...SUBSCRIPTION_FACTS, billingCycle: true, amount: true, plan: { select: { name: true } } },
        },
        paymentAccount: { select: { verificationStatus: true } },
      },
    });
    if (!org) return { success: true, data: null };

    const [{ graceDays }, figures, products, ordersAllTime, members, transactions, domainOrders, history, setups] = await Promise.all([
      getBillingSettings(),
      figuresFor([org.id], now),
      prisma.inventoryItem.count({ where: { organizationId: org.id, parentItemId: null } }),
      prisma.order.count({ where: { organizationId: org.id, status: { not: 'CANCELLED' } } }),
      prisma.membership.findMany({
        where: { organizationId: org.id },
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          status: true,
          joinedAt: true,
          role: { select: { name: true } },
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.billingTransaction.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, createdAt: true, type: true, status: true, planName: true, billingCycle: true, amount: true, reference: true },
      }),
      prisma.domainOrder.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, domain: true, status: true, createdAt: true, fulfilledAt: true },
      }),
      prisma.auditLog.findMany({
        where: { organizationId: org.id, action: { in: ['platform.organization.suspended', 'platform.organization.restored'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, action: true, metadata: true, createdAt: true, user: { select: { name: true, email: true } } },
      }),
      setupProgressFor([org.id]),
    ]);
    const setup = setups.get(org.id);

    const sub = org.subscription;
    const access = resolveAccess(sub, now, graceDays);
    const f = figures.get(org.id)!;

    return {
      success: true,
      data: {
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status as 'ACTIVE' | 'SUSPENDED' | 'DELETED',
          createdAt: org.createdAt,
          suspendedAt: org.suspendedAt,
          suspensionReason: org.suspensionReason,
          closure: org.closedAt
            ? {
                closedAt: org.closedAt,
                reason: org.closureReason,
                restorableUntil: org.closedDataPurgedAt || now >= restorableUntil(org.closedAt) ? null : restorableUntil(org.closedAt),
                purged: Boolean(org.closedDataPurgedAt),
                erasedAt: erasedAt(org.closedAt),
              }
            : null,
          customStoreDomain: org.customStoreDomain,
          supportEmail: org.supportEmail,
          supportPhone: org.supportPhone,
        },
        plan: {
          name: sub?.plan?.name ?? null,
          state: access.state,
          status: sub?.status ?? null,
          billingCycle: sub?.billingCycle ?? null,
          amount: sub?.amount == null ? null : Number(sub.amount),
          trialEndsAt: sub?.trialEndsAt ?? null,
          currentPeriodEnd: sub?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
          graceEndsAt: access.graceEndsAt,
        },
        verificationStatus: (org.paymentAccount?.verificationStatus ?? 'UNVERIFIED') as VerificationStatus,
        setup: {
          ...setupOf(setup),
          steps: (setup?.steps ?? []).map((st) => ({ title: st.title, done: st.done, required: st.required, optional: st.optional })),
        },
        figures: {
          stores: f.stores,
          products,
          ordersThisMonth: f.orders,
          takingsThisMonth: f.takings,
          ordersAllTime,
        },
        members: members.map((m) => ({
          id: m.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role.name,
          status: m.status,
          joinedAt: m.joinedAt,
        })),
        transactions: transactions.map((t) => ({
          id: t.id,
          createdAt: t.createdAt,
          type: t.type,
          status: t.status,
          planName: t.planName,
          billingCycle: t.billingCycle,
          amount: Number(t.amount),
          reference: t.reference,
        })),
        domainOrders,
        history: history.map((h) => {
          const reason = (h.metadata as { reason?: unknown } | null)?.reason;
          return {
            id: h.id,
            action: h.action,
            staffName: h.user?.name ?? h.user?.email ?? null,
            reason: typeof reason === 'string' ? reason : null,
            createdAt: h.createdAt,
          };
        }),
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load this merchant');
  }
}

/* ---------------- suspend and restore (11.4) ---------------- */

const ReasonSchema = z
  .string()
  .trim()
  .min(10, 'Say why in a sentence or two — the merchant will read it.')
  .max(1000, 'Keep the reason to 1,000 characters.');


/**
 * Suspends a workspace: its admin shows the "suspended" page (with this
 * reason) and its storefront goes offline, both enforced in proxy.ts.
 * Nothing is deleted. The owners are emailed.
 */
export async function suspendOrganization(organizationId: string, reason: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const parsed = ReasonSchema.safeParse(reason);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

    const updated = await prisma.organization.updateMany({
      where: { id: organizationId, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: parsed.data },
    });
    if (updated.count === 0) {
      return { success: false, error: 'This workspace isn’t active — someone may have suspended it already.' };
    }
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, slug: true } });
    forgetOrgStatus(org.slug);

    await createAuditLog({
      organizationId,
      userId: staff.userId,
      action: 'platform.organization.suspended',
      entityType: 'Organization',
      entityId: organizationId,
      metadata: { reason: parsed.data },
    });
    await sendWorkspaceSuspensionEmail({
      to: await ownerEmails(organizationId),
      workspaceName: org.name,
      outcome: 'suspended',
      reason: parsed.data,
      supportEmail: platformSupportEmail(),
      adminUrl: getAdminUrl(org.slug, '/dashboard'),
    });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t suspend this workspace');
  }
}

/** Lifts a suspension: the admin and the storefront open again as they were. */
export async function restoreOrganization(organizationId: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const before = await prisma.organization.findFirst({
      where: { id: organizationId, status: 'SUSPENDED' },
      select: { name: true, slug: true, suspensionReason: true },
    });
    const updated = await prisma.organization.updateMany({
      where: { id: organizationId, status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
    });
    if (updated.count === 0 || !before) {
      return { success: false, error: 'This workspace isn’t suspended — someone may have restored it already.' };
    }
    forgetOrgStatus(before.slug);

    await createAuditLog({
      organizationId,
      userId: staff.userId,
      action: 'platform.organization.restored',
      entityType: 'Organization',
      entityId: organizationId,
      metadata: { previousReason: before.suspensionReason },
    });
    await sendWorkspaceSuspensionEmail({
      to: await ownerEmails(organizationId),
      workspaceName: before.name,
      outcome: 'restored',
      supportEmail: platformSupportEmail(),
      adminUrl: getAdminUrl(before.slug, '/dashboard'),
    });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t restore this workspace');
  }
}

/** Undo a workspace's closing, within the grace period (ROADMAP 13.8). */
export async function reopenClosedOrganization(organizationId: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    await restoreClosedWorkspace(organizationId, staff.userId);
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof WorkspaceClosureError) return { success: false, error: error.message };
    return denied(error, 'We couldn’t reopen this workspace');
  }
}

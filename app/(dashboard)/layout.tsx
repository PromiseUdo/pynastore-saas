import { headers } from 'next/headers';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { PlanEndedPage, PlanNotice, planLabel } from '@/components/layout/plan-notice';
import { getOrganizationContext } from '@/lib/organization';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { isOpenWhileLapsed } from '@/lib/billing/access';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrganizationContext();
  const [session, entitlements, requestHeaders] = await Promise.all([auth(), getOrganizationEntitlements(), headers()]);
  const { plan, access } = entitlements;
  const canManageBilling = hasPermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);
  const canViewMessages = hasPermission(ctx.membership.role.permissions, PERMISSIONS.MESSAGES_VIEW);

  /* A lapsed workspace opens only billing and the orders already placed
   * (ROADMAP 12.1). The path comes from proxy.ts, which sets it for every
   * admin request; without it (it can't happen through the proxy) the page is
   * shown rather than a merchant being locked out by mistake. */
  const adminPath = requestHeaders.get('x-admin-path');
  const closed = access.state === 'lapsed' && adminPath !== null && !isOpenWhileLapsed(adminPath);

  // Fetch all orgs the user belongs to for the org switcher.
  // This is done once in the layout and passed down — no DB call on every client nav.
  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.userId, status: 'ACTIVE', organization: { status: { not: 'DELETED' } } },
    select: {
      organization: {
        select: { id: true, name: true, slug: true, subscription: { select: { plan: { select: { name: true } } } } },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const orgs = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    // Each workspace's plan by name; the current one also says whether it's a trial or has ended.
    plan:
      m.organization.id === ctx.organization.id
        ? planLabel(access.state, plan.name)
        : (m.organization.subscription?.plan?.name ?? 'No plan'),
  }));

  const displayName = session?.user?.name ?? session?.user?.email ?? 'User';

  return (
    <DashboardLayout
      org={{
        name: ctx.organization.name,
        slug: ctx.organization.slug,
        plan: planLabel(access.state, plan.name),
        planState: access.state,
      }}
      orgs={orgs}
      canViewMessages={canViewMessages && !closed && access.state !== 'lapsed'}
      user={{
        name: session?.user?.name ?? null,
        email: session?.user?.email ?? null,
        image: session?.user?.image ?? null,
        initials: getInitials(displayName),
      }}
      notice={
        <PlanNotice
          state={access.state}
          planName={plan.name}
          trialEndsAt={access.trialEndsAt}
          graceEndsAt={access.graceEndsAt}
          canManageBilling={canManageBilling}
        />
      }
    >
      {closed ? <PlanEndedPage canManageBilling={canManageBilling} /> : children}
    </DashboardLayout>
  );
}

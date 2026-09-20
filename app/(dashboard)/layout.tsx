import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { getOrganizationContext } from '@/lib/organization';
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
  const session = await auth();

  // Fetch all orgs the user belongs to for the org switcher.
  // This is done once in the layout and passed down — no DB call on every client nav.
  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.userId, status: 'ACTIVE' },
    select: {
      organization: {
        select: { id: true, name: true, slug: true, plan: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const orgs = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    plan: m.organization.plan,
  }));

  const displayName = session?.user?.name ?? session?.user?.email ?? 'User';

  return (
    <DashboardLayout
      org={{
        name: ctx.organization.name,
        slug: ctx.organization.slug,
        plan: ctx.organization.plan,
      }}
      orgs={orgs}
      user={{
        name: session?.user?.name ?? null,
        email: session?.user?.email ?? null,
        image: session?.user?.image ?? null,
        initials: getInitials(displayName),
      }}
    >
      {children}
    </DashboardLayout>
  );
}

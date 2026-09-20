import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getAdminUrl } from '@/lib/tenant/urls';

/*
 * Root homepage — served only on the marketing domain (proxy.ts routes
 * every tenant subdomain elsewhere). Purely a server-side redirect gate.
 *
 * ┌─ Not authenticated  →  /login
 * ├─ Authenticated, has an active org membership  →  https://{slug}.{ROOT_DOMAIN}/dashboard
 * └─ Authenticated, no org  →  /onboarding
 */
export default async function HomePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
    select: { organization: { select: { slug: true } } },
    orderBy: { joinedAt: 'desc' },
  });

  if (!membership) {
    redirect('/onboarding');
  }

  redirect(getAdminUrl(membership.organization.slug, '/dashboard'));
}

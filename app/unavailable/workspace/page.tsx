/*
 * A suspended workspace's admin (ROADMAP 11.4). proxy.ts sends every request
 * on a suspended workspace's admin host here, so no other page, action or
 * data request runs.
 *
 * A member is told what happened, when, why (the reason staff wrote), what
 * still stands, and who to contact. Anyone else signed in learns only that
 * the workspace is unavailable. Members can still reach their other
 * workspaces from here.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ShieldAlert } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/format';
import { getAdminUrl } from '@/lib/tenant/urls';
import { platformSupportEmail } from '@/lib/platform-contact';
import { PLATFORM_NAME } from '@/lib/brand';
import { buttonVariants } from '@/components/ui/button-variants';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = { title: 'Workspace suspended', robots: { index: false, follow: false } };

export default async function WorkspaceSuspendedPage() {
  const slug = (await headers()).get('x-org-slug');
  const session = await auth();
  const userId = session?.user?.id;

  const org = slug
    ? await prisma.organization.findUnique({
        where: { slug },
        select: { id: true, name: true, status: true, suspendedAt: true, suspensionReason: true },
      })
    : null;
  const isMember =
    !!org &&
    !!userId &&
    (await prisma.membership.count({ where: { userId, organizationId: org.id, status: 'ACTIVE' } })) > 0;
  const others = userId
    ? await prisma.membership.findMany({
        where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE', ...(org ? { id: { not: org.id } } : {}) } },
        select: { organization: { select: { name: true, slug: true } } },
        orderBy: { joinedAt: 'asc' },
      })
    : [];
  const support = platformSupportEmail();

  return (
    <main className="flex min-h-full items-center justify-center bg-muted/30 px-4 py-16">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-xs sm:p-8">
        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="size-5" aria-hidden />
        </div>

        {isMember && org ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-foreground">{org.name} has been suspended</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {PLATFORM_NAME} suspended this workspace
              {org.suspendedAt ? ` on ${formatDate(org.suspendedAt)}` : ''}. While it’s suspended, its dashboard is closed
              and its shop is offline to customers.
            </p>
            {org.suspensionReason && (
              <div className="mt-4 rounded-md border bg-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">Reason given</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{org.suspensionReason}</p>
              </div>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing has been deleted: products, orders and customers are kept, and everything reopens as it was if the
              suspension is lifted.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold text-foreground">This workspace is unavailable</h1>
            <p className="mt-1 text-sm text-muted-foreground">It can’t be opened at the moment.</p>
          </>
        )}

        {support && (
          <p className="mt-4 text-sm text-foreground">
            Questions? Write to{' '}
            <a href={`mailto:${support}`} className="font-medium text-primary hover:underline">
              {support}
            </a>
            .
          </p>
        )}

        {others.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">Your other workspaces</p>
            <ul className="mt-2 space-y-1">
              {others.map((m) => (
                <li key={m.organization.slug}>
                  <a href={getAdminUrl(m.organization.slug, '/dashboard')} className={buttonVariants({ variant: 'link', size: 'sm', className: 'h-auto px-0' })}>
                    {m.organization.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {userId && (
          <div className="mt-6 flex justify-end">
            <SignOutButton />
          </div>
        )}
      </div>
    </main>
  );
}

/*
 * Settings → Your account (ROADMAP 19.3) — this person's own sign-in, not the
 * shop's: who they're signed in as, and deleting the account. Every member
 * has one, so no permission is needed, and it stays open while the shop's
 * plan has lapsed (lib/billing/access.ts).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { prisma } from '@/lib/prisma';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { DeleteAccount } from '@/components/account/delete-account';
import { loadDeleteAccount } from '@/features/account/load';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountSettingsPage() {
  const ctx = await getOrganizationContext();
  const [user, deletion] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true, password: true, accounts: { select: { provider: true } } } }),
    loadDeleteAccount(ctx.userId),
  ]);
  if (!user || !deletion) notFound();

  const signIn = [user.password && 'Email and password', ...user.accounts.map((a) => (a.provider === 'google' ? 'Google' : a.provider === 'apple' ? 'Apple' : null))]
    .filter(Boolean)
    .join(', ');

  return (
    <div>
      <PageHeader title="Your account" description="Your own sign-in. It’s yours, not the shop’s: the same account works in every shop you’re a member of." />
      <PageBody className="max-w-3xl space-y-6">
        <section className="rounded-lg border bg-card p-5 shadow-xs">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="mt-0.5 font-medium text-foreground">{user.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="mt-0.5 break-all font-medium text-foreground">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Signs in with</dt>
              <dd className="mt-0.5 font-medium text-foreground">{signIn || '—'}</dd>
            </div>
          </dl>
        </section>
        <DeleteAccount {...deletion} />
      </PageBody>
    </div>
  );
}

/*
 * Settings → Your account (ROADMAP 19.3, 14.5) — this person's own sign-in,
 * not the shop's: their name, email and password, two-step sign-in, signing
 * out other devices, and deleting the account. Every member
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
import { AccountSecurity } from '@/components/account/account-security';
import { twoFactorStatus } from '@/lib/account-security/two-factor';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountSettingsPage() {
  const ctx = await getOrganizationContext();
  const [user, deletion, twoFactor] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true, password: true, accounts: { select: { provider: true } } } }),
    loadDeleteAccount(ctx.userId),
    twoFactorStatus(ctx.userId),
  ]);
  if (!user || !deletion) notFound();

  const otherSignIns = user.accounts
    .map((a): string | null => (a.provider === 'google' ? 'Google' : a.provider === 'apple' ? 'Apple' : null))
    .filter((p): p is string => p !== null);

  return (
    <div>
      <PageHeader title="Your account" description="Your own sign-in. It’s yours, not the shop’s: the same account works in every shop you’re a member of." />
      <PageBody className="max-w-3xl space-y-6">
        <AccountSecurity
          name={user.name}
          email={user.email}
          hasPassword={Boolean(user.password)}
          otherSignIns={[...new Set(otherSignIns)]}
          twoFactor={twoFactor}
        />
        <DeleteAccount {...deletion} />
      </PageBody>
    </div>
  );
}

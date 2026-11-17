/*
 * Console → Your account: the signed-in staff member's own sign-in — name,
 * email, password, two-step sign-in and signing out other devices. The same
 * panel as a shop's Settings → Your account, which a staff account with no
 * shop could never reach. Account deletion is left out on purpose: a staff
 * account is removed by another staff member, not from the console itself.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPlatformStaff } from '@/lib/platform-staff';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { AccountSecurity } from '@/components/account/account-security';
import { twoFactorStatus } from '@/lib/account-security/two-factor';

export const metadata: Metadata = { title: 'Your account' };

export default async function ConsoleAccountPage() {
  const staff = await getPlatformStaff();
  if (!staff) notFound();

  const [user, twoFactor] = await Promise.all([
    prisma.user.findUnique({
      where: { id: staff.userId },
      select: { name: true, email: true, password: true, accounts: { select: { provider: true } } },
    }),
    twoFactorStatus(staff.userId),
  ]);
  if (!user) notFound();

  const otherSignIns = user.accounts
    .map((a): string | null => (a.provider === 'google' ? 'Google' : a.provider === 'apple' ? 'Apple' : null))
    .filter((p): p is string => p !== null);

  return (
    <div>
      <PageHeader
        title="Your account"
        description="Your own sign-in to the console. Turn on two-step sign-in: this account can see every shop."
      />
      <PageBody className="max-w-3xl space-y-6">
        <AccountSecurity
          name={user.name}
          email={user.email}
          hasPassword={Boolean(user.password)}
          otherSignIns={[...new Set(otherSignIns)]}
          twoFactor={twoFactor}
        />
      </PageBody>
    </div>
  );
}

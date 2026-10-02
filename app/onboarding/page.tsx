/*
 * /onboarding — "Create your shop" (ROADMAP 12.5), on the platform host.
 *
 * Waits for a confirmed email first; then one short form. Says up front
 * whether the new shop comes with a free trial, and of what.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Wordmark } from '@/components/marketing/wordmark';
import { getBillingSettings } from '@/lib/settings';
import { planByKey } from '@/lib/billing/catalogue';
import { CreateShopForm } from './CreateShopForm';
import { VerifyEmailGate } from './VerifyEmailGate';

export const metadata: Metadata = { title: 'Create your shop' }; // the root layout adds the platform name

export default async function OnboardingPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login?callbackUrl=/onboarding');

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, emailVerified: true } });
  if (!user) redirect('/login');

  // Same rule as lib/billing/trial.ts: one trial per owner.
  const [settings, hadTrial, hasWorkspace] = await Promise.all([
    getBillingSettings(),
    prisma.subscription.findFirst({
      where: {
        trialStartedAt: { not: null },
        organization: { memberships: { some: { userId, role: { isSystem: true, name: 'Owner' } } } },
      },
      select: { id: true },
    }),
    prisma.membership.count({ where: { userId, status: 'ACTIVE', organization: { status: { in: ['ACTIVE', 'SUSPENDED'] } } } }),
  ]);
  const trialPlan = !hadTrial && settings.trialDays > 0 ? await planByKey(settings.trialPlanKey) : null;
  const trial = trialPlan ? { days: settings.trialDays, planName: trialPlan.name } : null;

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10 sm:py-14">
      <Wordmark className="mb-8" />

      {user.emailVerified ? (
        <CreateShopForm trial={trial} isAnotherShop={hasWorkspace > 0} />
      ) : (
        <VerifyEmailGate email={user.email} />
      )}
    </div>
  );
}

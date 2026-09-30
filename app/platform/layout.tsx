/*
 * The platform console (ROADMAP 11) — where MansaaS staff act across
 * merchants. It lives on the platform host at /platform, outside every shop:
 * proxy.ts makes sure there is a session, and this layout makes sure the user
 * is platform staff. Anyone else gets a plain 404, not an access-denied page —
 * there's no reason to confirm the console exists.
 *
 * It uses the admin's look (tokens, type scale, components) but no shop:
 * there's no organization here, only the merchants being looked after. The
 * frame — sidebar, and a drawer on small screens — is ConsoleShell (11.0).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformStaff } from '@/lib/platform-staff';
import { PLATFORM_NAME } from '@/lib/brand';
import { Toaster } from '@/components/ui/toaster';
import { ConsoleShell } from '@/components/platform/console-shell';
import { pendingVerificationCount } from '@/features/platform/overview';
import { waitingDomainCount } from '@/features/platform/domains';
import { paymentAttentionCount } from '@/features/platform/payments';
import { jobsAttentionCount } from '@/features/platform/jobs';

export const metadata: Metadata = {
  title: { default: 'Platform console', template: `%s · Platform console · ${PLATFORM_NAME}` },
  robots: { index: false, follow: false },
};

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const staff = await getPlatformStaff();
  if (!staff) notFound();

  const [pending, domains, payments, jobs] = await Promise.all([
    pendingVerificationCount(),
    waitingDomainCount(),
    paymentAttentionCount(),
    jobsAttentionCount(),
  ]);

  return (
    <>
      <ConsoleShell
        staff={{ name: staff.name, email: staff.email }}
        counts={{ '/platform/verification': pending, '/platform/domains': domains, '/platform/payments': payments, '/platform/jobs': jobs }}
        platformName={PLATFORM_NAME}
      >
        {children}
      </ConsoleShell>
      <Toaster />
    </>
  );
}

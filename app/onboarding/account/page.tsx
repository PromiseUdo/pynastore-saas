/*
 * /onboarding/account (ROADMAP 19.3) — deleting your account before you have
 * a shop. Someone can sign up and never create one, and the app stores (and
 * the law) expect them to be able to delete what they made, in the same
 * place they made it. On the platform host and the business host alike.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Wordmark } from '@/components/marketing/wordmark';
import { Toaster } from '@/components/ui/toaster';
import { DeleteAccount } from '@/components/account/delete-account';
import { loadDeleteAccount } from '@/features/account/load';

export const metadata: Metadata = { title: 'Your account' };

export default async function OnboardingAccountPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login?callbackUrl=/onboarding/account');
  const deletion = await loadDeleteAccount(userId);
  if (!deletion) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10 sm:py-14">
      <Wordmark className="mb-8" />
      <div className="w-full max-w-lg space-y-4">
        <Link href="/onboarding" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
        <DeleteAccount {...deletion} />
      </div>
      <Toaster />
    </div>
  );
}

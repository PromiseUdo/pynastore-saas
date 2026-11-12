/*
 * /account/verify
 *
 * Where a shopper types the six-digit code that proves their email (ROADMAP
 * 20.1). Registering, or signing in to an account whose address was never
 * proved, lands here; nobody is signed in until the code is right.
 *
 * Which account this is comes from the host-only `sf-verify-{slug}` cookie
 * the registration or sign-in set — never from the URL — so a link to this
 * page shows a stranger nothing.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getShopper } from '@/lib/storefront/account/session';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { findPendingVerification, readVerifyCookie } from '@/lib/storefront/account/email-verification';
import { safeNextPath } from '@/lib/storefront/account/return-url';
import { AuthShell } from '../_components/auth-shell';
import { VerifyEmailForm } from '../_components/verify-email-form';

export const metadata: Metadata = { title: 'Confirm your email' };

type Props = {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ next?: string }>;
};

export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const { organizationSlug } = await params;
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);

  if (await getShopper()) redirect(next);

  const store = await findStoreBySlug(organizationSlug);
  const rawToken = await readVerifyCookie(organizationSlug);
  const pending = store && rawToken ? await findPendingVerification(store.id, rawToken) : null;

  if (!pending) {
    return (
      <AuthShell
        title="Sign in to get a code"
        intro="We couldn’t find a code waiting on this device."
        footer={
          <Link
            href={`/account/sign-in?next=${encodeURIComponent(next)}`}
            className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
          >
            Sign in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Sign in with your email and password, and we&apos;ll send a fresh code to confirm your email.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Confirm your email"
      intro="One last step, so nobody else can use your address."
      footer={
        <>
          Wrong email?{' '}
          <Link
            href={`/account/register?next=${encodeURIComponent(next)}`}
            className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
          >
            Create your account again
          </Link>
        </>
      }
    >
      <VerifyEmailForm
        next={next}
        email={pending.email}
        expired={pending.expired}
        locked={pending.locked}
      />
    </AuthShell>
  );
}

/*
 * /account/sign-in
 *
 * Signing in is an accelerator, never a gate: the page can be reached from
 * anywhere, and it always offers a way back to shopping without an account.
 * `?next=` is where the shopper was — checked with safeNextPath, because it
 * came out of a URL.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getShopper } from '@/lib/storefront/account/session';
import { googleStartHref } from '@/lib/storefront/account/google-link';
import { googleConfigured } from '@/lib/storefront/account/google';
import { safeNextPath } from '@/lib/storefront/account/return-url';
import { AuthDivider, AuthError, AuthShell } from '../_components/auth-shell';
import { GoogleButton } from '../_components/google-button';
import { SignInForm } from '../_components/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

type Props = {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function SignInPage({ params, searchParams }: Props) {
  const { organizationSlug } = await params;
  const { next: rawNext, error } = await searchParams;
  const next = safeNextPath(rawNext);

  // Already signed in: nothing to do here.
  const shopper = await getShopper();
  if (shopper) redirect(next);

  const googleHref = googleConfigured()
    ? await googleStartHref({ slug: organizationSlug, next })
    : null;

  return (
    <AuthShell
      title="Sign in"
      intro="Your saved details, your wishlist and your orders — all in one place."
      footer={
        <>
          New here?{' '}
          <Link
            href={`/account/register?next=${encodeURIComponent(next)}`}
            className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
          >
            Create an account
          </Link>
        </>
      }
    >
      {error === 'google' && (
        <AuthError>
          We couldn&apos;t finish signing you in with Google. Please try again, or use your email
          and password.
        </AuthError>
      )}

      {googleHref && (
        <>
          <GoogleButton href={googleHref} label="Continue with Google" />
          <AuthDivider />
        </>
      )}

      <SignInForm next={next} />
    </AuthShell>
  );
}

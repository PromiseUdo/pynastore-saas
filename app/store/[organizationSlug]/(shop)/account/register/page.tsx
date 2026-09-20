/*
 * /account/register
 *
 * Three fields and a Google button. Everything else a shop needs to know
 * about a person — phone, delivery address — is asked for at checkout, where
 * it is obvious why it is being asked.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getShopper } from '@/lib/storefront/account/session';
import { googleStartHref } from '@/lib/storefront/account/google-link';
import { googleConfigured } from '@/lib/storefront/account/google';
import { safeNextPath } from '@/lib/storefront/account/return-url';
import { AuthDivider, AuthShell } from '../_components/auth-shell';
import { GoogleButton } from '../_components/google-button';
import { RegisterForm } from '../_components/register-form';

export const metadata: Metadata = { title: 'Create an account' };

type Props = {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ next?: string }>;
};

export default async function RegisterPage({ params, searchParams }: Props) {
  const { organizationSlug } = await params;
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);

  const shopper = await getShopper();
  if (shopper) redirect(next);

  const googleHref = googleConfigured()
    ? await googleStartHref({ slug: organizationSlug, next })
    : null;

  return (
    <AuthShell
      title="Create an account"
      intro="So your details are ready next time, and your orders are easy to find."
      footer={
        <>
          Already have one?{' '}
          <Link
            href={`/account/sign-in?next=${encodeURIComponent(next)}`}
            className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
          >
            Sign in
          </Link>
        </>
      }
    >
      {googleHref && (
        <>
          <GoogleButton href={googleHref} label="Sign up with Google" />
          <AuthDivider />
        </>
      )}

      <RegisterForm next={next} />
    </AuthShell>
  );
}

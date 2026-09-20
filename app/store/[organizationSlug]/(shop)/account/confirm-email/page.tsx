/*
 * /account/confirm-email?token=…
 *
 * The second half of an email change. Outside the (signed-in) group on
 * purpose: the link is very often opened on a phone where nobody is signed
 * in, and the token — not the session — is what proves the new inbox.
 *
 * The token is not spent by loading this page. Mail scanners, link previews
 * and "safe browsing" prefetchers all fetch URLs out of messages, and every
 * one of them would burn a single-use link before the shopper ever saw it.
 * So the page asks for one press first.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '../_components/auth-shell';
import { ConfirmEmailForm } from '../_components/confirm-email-form';

export const metadata: Metadata = { title: 'Confirm your email' };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ConfirmEmailPage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthShell
        title="That link is incomplete"
        intro="Confirmation links only work in full, and only once."
        footer={
          <Link
            href="/account/profile"
            className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
          >
            Back to your profile
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Open the link straight from the email, or ask for a new one from your profile.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Confirm your email"
      intro="One press and this becomes the address you sign in with, and where order updates go."
    >
      <ConfirmEmailForm token={token} />
    </AuthShell>
  );
}

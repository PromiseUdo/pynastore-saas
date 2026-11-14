/*
 * /account/reset-password?token=…
 *
 * The token is not validated here — only when it is spent. A page that told
 * a visitor "that token is valid" before they set anything would be a small
 * oracle for guessing tokens, and the form has to handle the expired case
 * anyway (a link opened an hour late).
 *
 * `invite=1`: the same link, sent when a merchant invites a trade buyer who
 * has no sign-in yet (ROADMAP 21.1). Only the words change — following it
 * proves the address and sets their first password, exactly as a reset does.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '../_components/auth-shell';
import { ResetPasswordForm } from '../_components/reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

type Props = { searchParams: Promise<{ token?: string; invite?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, invite } = await searchParams;
  const invited = invite === '1';

  if (!token) {
    return (
      <AuthShell
        title="That link is incomplete"
        intro="Password reset links only work in full, and only once."
        footer={
          <Link
            href="/account/forgot-password"
            className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
          >
            Send me a new link
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Open the link straight from the email, or ask for a fresh one.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invited ? 'Set up your sign-in' : 'Choose a new password'}
      intro={
        invited
          ? 'Choose a password for your account. You’ll be signed in as soon as it’s saved.'
          : "Pick something you'll remember. You'll be signed in as soon as it's saved."
      }
      footer={
        <Link
          href="/account/sign-in"
          className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
        >
          Back to sign in
        </Link>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}

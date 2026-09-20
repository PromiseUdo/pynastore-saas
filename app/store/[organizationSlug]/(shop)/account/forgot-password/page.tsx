/*
 * /account/forgot-password — ask for a reset link.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '../_components/auth-shell';
import { ForgotPasswordForm } from '../_components/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password"
      intro="Tell us the email you shop with and we'll send you a link to choose a new password."
      footer={
        <Link
          href="/account/sign-in"
          className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
        >
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}

/*
 * The link in the "Confirm your email" message (ROADMAP 12.5).
 *
 * Confirming takes a press of the button, not just opening the page: mail
 * scanners open links on the merchant's behalf, and a link used up by a
 * scanner would leave the merchant with a dead one.
 */
import type { Metadata } from 'next';
import { ConfirmEmailForm } from './ConfirmEmailForm';

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false, follow: false } };

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConfirmEmailForm token={token} />;
}

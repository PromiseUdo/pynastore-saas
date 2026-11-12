/*
 * The link in the "Confirm your email" message (ROADMAP 12.5).
 *
 * Opening the link confirms it, from the browser once the page has loaded
 * (ConfirmEmailForm) — not while the server renders it, so mail scanners
 * that only fetch the page don't use the link up.
 */
import type { Metadata } from 'next';
import { ConfirmEmailForm } from './ConfirmEmailForm';

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false, follow: false } };

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConfirmEmailForm token={token} />;
}

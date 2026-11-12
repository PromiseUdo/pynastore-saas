/*
 * The link sent to a staff member's NEW email (ROADMAP 14.5). It moves the
 * account only when the button is pressed — not on opening — so a mail
 * scanner that fetches links ahead of people can't move anyone's account.
 */
import type { Metadata } from 'next';
import { ConfirmNewEmail } from './ConfirmNewEmail';

export const metadata: Metadata = { title: 'Confirm your new email', robots: { index: false, follow: false } };

export default async function ConfirmNewEmailPage({ params }: { params: Promise<{ token: string }> }) {
  return <ConfirmNewEmail token={(await params).token} />;
}

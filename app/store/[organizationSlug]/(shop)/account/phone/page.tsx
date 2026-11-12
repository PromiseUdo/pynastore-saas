/*
 * /account/phone
 *
 * The one-time "add your phone number" step (ROADMAP 20.2). Every account's
 * wallet needs a phone; registration asks for it, but Google doesn't share
 * one, and accounts made before the rule have none. They land here once —
 * straight after Google sign-in, or the next time they open their account —
 * and go on to where they were heading.
 *
 * Outside the (signed-in) group on purpose: that layout is what sends people
 * here, and it would send them here again.
 */
import type { Metadata } from 'next';
import { edupayConfigured } from '@/lib/wallet/edupay';
import { redirect } from 'next/navigation';
import { getShopper } from '@/lib/storefront/account/session';
import { safeNextPath } from '@/lib/storefront/account/return-url';
import { AuthShell } from '../_components/auth-shell';
import { AddPhoneForm } from '../_components/add-phone-form';

export const metadata: Metadata = { title: 'Add your phone number' };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function AddPhonePage({ searchParams }: Props) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);

  const shopper = await getShopper();
  if (!shopper) redirect(`/account/sign-in?next=${encodeURIComponent(next)}`);
  if (shopper.phone) redirect(next);

  return (
    <AuthShell
      title="Add your phone number"
      intro={`Hi ${shopper.firstName} — one more detail to finish your account.`}
    >
      <AddPhoneForm next={next} walletNotice={edupayConfigured()} />
    </AuthShell>
  );
}

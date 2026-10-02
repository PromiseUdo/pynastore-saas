'use server';

/*
 * features/shop-account/data-actions.ts
 *
 * A signed-in shopper deleting their own account (ROADMAP 13.8). The account
 * is the one the session cookie proves — never an id from the form — and the
 * shopper proves it's them once more: their password, or for a Google-only
 * account, their email typed out. What deleting means is in
 * lib/data-rights/shopper.ts.
 */
import { redirect } from 'next/navigation';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { deleteShopperAccount } from '@/lib/data-rights/shopper';
import { clearSessionCookie, currentStoreSlug, getShopper } from '@/lib/storefront/account/session';

export type DeleteAccountState = { error?: string; fieldErrors?: { confirm?: string } } | null;

export async function deleteAccountAction(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const slug = await currentStoreSlug();
  const shopper = await getShopper();
  if (!slug || !shopper) return { error: 'Your session has ended. Please sign in again.' };

  if (!(await checkRateLimit(`delete-account:${shopper.id}`, 5, 15 * 60 * 1000))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }

  const confirm = String(formData.get('confirm') ?? '');
  const account = await prisma.customer.findFirst({
    where: { id: shopper.id, organizationId: shopper.organizationId },
    select: { passwordHash: true, email: true },
  });
  if (!account) return { error: 'Your session has ended. Please sign in again.' };

  const proven = account.passwordHash
    ? Boolean(confirm) && (await compare(confirm, account.passwordHash))
    : confirm.trim().toLowerCase() === (account.email ?? '').toLowerCase();
  if (!proven) {
    return { fieldErrors: { confirm: account.passwordHash ? 'That isn’t your password' : 'Type your email address exactly as shown' } };
  }

  await deleteShopperAccount(shopper.organizationId, shopper.id);
  await clearSessionCookie(slug);
  redirect('/account/deleted');
}

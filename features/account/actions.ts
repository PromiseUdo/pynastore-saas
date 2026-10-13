'use server';

/*
 * The signed-in person's own account (ROADMAP 19.3): deleting it. Works with
 * or without a shop — from Settings → Your account, and from onboarding for
 * someone who never made one. See lib/data-rights/staff.ts for what goes and
 * what stays.
 */
import { auth } from '@/lib/auth';
import { deleteStaffAccount } from '@/lib/data-rights/staff';

export type DeleteAccountResult = { success: true } | { success: false; error: string; shops?: { name: string; slug: string }[] };

export async function deleteMyAccount(confirmation: string): Promise<DeleteAccountResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: 'Sign in again to continue.' };

  const result = await deleteStaffAccount(userId, String(confirmation ?? '').slice(0, 500));
  if (result.ok) return { success: true };
  switch (result.reason) {
    case 'wrong-confirmation':
      return { success: false, error: 'That doesn’t match. Nothing was deleted.' };
    case 'sole-owner':
      return {
        success: false,
        error: 'You’re the only Owner of a shop. Make another member an Owner, or close the shop, first.',
        shops: result.shops,
      };
    default:
      return { success: false, error: 'We couldn’t find your account. Sign in again to continue.' };
  }
}

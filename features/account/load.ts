/*
 * What the "Delete my account" card needs (ROADMAP 19.3), for the signed-in
 * person. Server only. Links to the shops that still need another Owner go
 * through adminUrlHere, so on the business host they stay on it.
 */
import { prisma } from '@/lib/prisma';
import { staffDeletionBlockers } from '@/lib/data-rights/staff';
import { adminUrlHere } from '@/lib/tenant/here';
import type { OwnedShop } from '@/components/account/delete-account';

export async function loadDeleteAccount(userId: string): Promise<{ email: string; confirmWith: 'password' | 'email'; soleOwnerOf: OwnedShop[] } | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { email: true, password: true } });
  if (!user) return null;
  const blockers = await staffDeletionBlockers(userId);
  const soleOwnerOf = await Promise.all(
    blockers.map(async (shop) => ({
      name: shop.name,
      membersHref: await adminUrlHere(shop.slug, '/settings/members'),
      closeHref: await adminUrlHere(shop.slug, '/settings/data'),
    })),
  );
  return { email: user.email, confirmWith: user.password ? 'password' : 'email', soleOwnerOf };
}

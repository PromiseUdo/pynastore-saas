/*
 * lib/org-owners.ts
 *
 * Who to write to about a workspace: its owners — and, when asked, the
 * payments contact the merchant gave for online payments (ROADMAP 10.2), who
 * is often the person who looks after money matters. Server only.
 */
import { prisma } from '@/lib/prisma';
import { SYSTEM_ROLES } from '@/lib/permissions';

export async function ownerEmails(
  organizationId: string,
  options: { includePaymentsContact?: boolean } = {},
): Promise<string[]> {
  const [owners, account] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE', role: { isSystem: true, name: SYSTEM_ROLES.OWNER.name } },
      select: { user: { select: { email: true } } },
    }),
    options.includePaymentsContact
      ? prisma.merchantPaymentAccount.findUnique({ where: { organizationId }, select: { contactEmail: true } })
      : null,
  ]);
  return [...new Set([...owners.map((o) => o.user.email), ...(account?.contactEmail ? [account.contactEmail] : [])])];
}

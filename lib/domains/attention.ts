/*
 * The dashboard's "needs attention" line for a registered domain due to
 * renew (ROADMAP 12.6): from 30 days before the renewal deadline, until the
 * merchant has paid to renew.
 */
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/format';
import { renewalDeadline, renewalStage } from './rules';

export async function domainAttention(organizationId: string, now = new Date()): Promise<string | null> {
  const domain = await prisma.shopDomain.findUnique({ where: { organizationId } });
  if (!domain || domain.source !== 'REGISTERED' || !domain.expiresAt || !['LIVE', 'EXPIRED'].includes(domain.status)) return null;
  const stage = renewalStage(domain.expiresAt, now);
  if (stage === 'ok' || stage === 'released') return null;
  const paid = await prisma.domainOrder.count({
    where: { organizationId, type: 'RENEW', status: 'PENDING_FULFILLMENT', billingTransaction: { status: 'SUCCESS' } },
  });
  if (paid) return null;
  if (stage === 'renew_soon') return `Your domain ${domain.hostname} needs renewing by ${formatDate(renewalDeadline(domain.expiresAt))}`;
  if (stage === 'past_deadline') return `Renew ${domain.hostname} now — it stops working on ${formatDate(domain.expiresAt)}`;
  return `${domain.hostname} has expired — your shop is back on its platform address`;
}

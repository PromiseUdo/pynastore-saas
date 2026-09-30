/*
 * lib/platform-audit.ts
 *
 * Writes the console's own audit trail (ROADMAP 11.7) — changes that belong
 * to no one merchant. Unlike createAuditLog, a failure here is NOT swallowed:
 * it is written in the same transaction as the change, so a change without
 * its record doesn't happen.
 */
import type { Prisma } from '@/lib/generated/prisma/client';
import type { prisma } from '@/lib/prisma';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type PlatformAuditAction =
  | 'platform.plan.created'
  | 'platform.plan.updated'
  | 'platform.plan.retired'
  | 'platform.plan.restored'
  | 'platform.plan.reordered'
  | 'platform.plan.deleted'
  | 'platform.settings.updated';

/** What each action is called in the console's "Recent changes". */
export const PLATFORM_AUDIT_LABELS: Record<PlatformAuditAction, string> = {
  'platform.plan.created': 'Created a plan',
  'platform.plan.updated': 'Edited a plan',
  'platform.plan.retired': 'Took a plan off sale',
  'platform.plan.restored': 'Put a plan back on sale',
  'platform.plan.reordered': 'Moved a plan',
  'platform.plan.deleted': 'Deleted a plan',
  'platform.settings.updated': 'Changed billing settings',
};

export async function writePlatformAudit(
  tx: Tx,
  entry: {
    userId: string;
    action: PlatformAuditAction;
    entityType: 'BillingPlan' | 'PlatformSetting';
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.platformAuditLog.create({ data: entry });
}

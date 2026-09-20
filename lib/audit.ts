import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';

type AuditPayload = {
  organizationId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
};

export async function createAuditLog(payload: AuditPayload): Promise<void> {
  try {
    await prisma.auditLog.create({ data: payload });
  } catch (err) {
    console.error('[AuditLog] Failed to write audit log:', err);
  }
}

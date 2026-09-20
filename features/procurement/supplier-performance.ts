'use server';

import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { type ActionResult, toActionError } from './shared';

export type CostHistoryPoint = {
  itemId: string;
  itemName: string;
  date: Date;
  unitPrice: number;
};

export type SupplierPerformance = {
  supplierId: string;
  supplierName: string;
  totalPOs: number;
  receivedPOs: number;
  onTimeRate: number | null; // null when no PO has both expectedAt and receivedAt
  avgLeadTimeDays: number | null;
  totalSpend: number;
  costHistory: CostHistoryPoint[];
};

export async function getSupplierPerformance(supplierId: string): Promise<ActionResult<SupplierPerformance>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_VIEW);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, organizationId: true },
    });
    if (!supplier || supplier.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Supplier not found' };
    }

    const pos = await prisma.purchaseOrder.findMany({
      where: { organizationId: ctx.organization.id, supplierId },
      select: {
        status: true,
        totalAmount: true,
        createdAt: true,
        expectedAt: true,
        receivedAt: true,
        lineItems: {
          select: {
            unitPrice: true,
            inventoryItemId: true,
            inventoryItem: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const receivedPOs = pos.filter((po) => po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED');
    const totalSpend = receivedPOs.reduce((sum, po) => sum + Number(po.totalAmount), 0);

    const onTimeEligible = pos.filter((po) => po.expectedAt && po.receivedAt);
    const onTimeCount = onTimeEligible.filter((po) => po.receivedAt! <= po.expectedAt!).length;
    const onTimeRate = onTimeEligible.length > 0 ? onTimeCount / onTimeEligible.length : null;

    const leadTimeEligible = pos.filter((po) => po.receivedAt);
    const avgLeadTimeDays =
      leadTimeEligible.length > 0
        ? leadTimeEligible.reduce((sum, po) => {
            const days = (po.receivedAt!.getTime() - po.createdAt.getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / leadTimeEligible.length
        : null;

    const costHistory: CostHistoryPoint[] = pos.flatMap((po) =>
      po.lineItems
        .filter((li) => li.inventoryItemId)
        .map((li) => ({
          itemId: li.inventoryItemId!,
          itemName: li.inventoryItem?.name ?? 'Unknown item',
          date: po.createdAt,
          unitPrice: Number(li.unitPrice),
        })),
    );

    return {
      success: true,
      data: {
        supplierId: supplier.id,
        supplierName: supplier.name,
        totalPOs: pos.length,
        receivedPOs: receivedPOs.length,
        onTimeRate,
        avgLeadTimeDays,
        totalSpend,
        costHistory,
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load supplier performance');
  }
}

'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { SupplierStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError } from './shared';

export type SupplierRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  status: SupplierStatus;
  notes: string | null;
  purchaseOrderCount: number;
};

const SupplierSchema = z.object({
  name: z.string().min(1, 'Name is required').max(150),
  email: z.string().email().max(150).optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  taxId: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),
});

export async function listSuppliers(): Promise<ActionResult<SupplierRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_VIEW);

    const suppliers = await prisma.supplier.findMany({
      where: { organizationId: ctx.organization.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        taxId: true,
        status: true,
        notes: true,
        _count: { select: { purchaseOrders: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        address: s.address,
        taxId: s.taxId,
        status: s.status,
        notes: s.notes,
        purchaseOrderCount: s._count.purchaseOrders,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load suppliers');
  }
}

export async function createSupplier(
  input: z.infer<typeof SupplierSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_CREATE);

    const data = SupplierSchema.parse(input);

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: ctx.organization.id,
        name: data.name,
        email: data.email || undefined,
        phone: data.phone,
        address: data.address,
        taxId: data.taxId,
        notes: data.notes,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.supplier.created',
      entityType: 'Supplier',
      entityId: supplier.id,
      metadata: { name: data.name },
    });

    return { success: true, data: { id: supplier.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create supplier');
  }
}

export async function updateSupplier(
  supplierId: string,
  input: z.infer<typeof SupplierSchema> & { status?: SupplierStatus },
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_EDIT);

    const data = SupplierSchema.parse(input);

    const existing = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { organizationId: true },
    });
    if (!existing || existing.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Supplier not found' };
    }

    await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone,
        address: data.address,
        taxId: data.taxId,
        notes: data.notes,
        status: input.status,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.supplier.updated',
      entityType: 'Supplier',
      entityId: supplierId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to update supplier');
  }
}

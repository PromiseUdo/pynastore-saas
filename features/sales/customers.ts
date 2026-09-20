'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { CustomerStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError } from './shared';

export type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  status: CustomerStatus;
  quoteCount: number;
  invoiceCount: number;
};

const CustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(150),
  email: z.string().email().max(150).optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  taxId: z.string().max(60).optional(),
});

export async function listCustomers(): Promise<ActionResult<CustomerRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_VIEW);

    const customers = await prisma.customer.findMany({
      where: { organizationId: ctx.organization.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        taxId: true,
        status: true,
        _count: { select: { quotes: true, invoices: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        taxId: c.taxId,
        status: c.status,
        quoteCount: c._count.quotes,
        invoiceCount: c._count.invoices,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load customers');
  }
}

export async function createCustomer(
  input: z.infer<typeof CustomerSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_CREATE);

    const data = CustomerSchema.parse(input);

    const customer = await prisma.customer.create({
      data: {
        organizationId: ctx.organization.id,
        name: data.name,
        email: data.email || undefined,
        phone: data.phone,
        address: data.address,
        taxId: data.taxId,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.customer.created',
      entityType: 'Customer',
      entityId: customer.id,
      metadata: { name: data.name },
    });

    return { success: true, data: { id: customer.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create customer');
  }
}

export async function updateCustomer(
  customerId: string,
  input: z.infer<typeof CustomerSchema> & { status?: CustomerStatus },
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_EDIT);

    const data = CustomerSchema.parse(input);

    const existing = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { organizationId: true },
    });
    if (!existing || existing.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Customer not found' };
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone,
        address: data.address,
        taxId: data.taxId,
        status: input.status,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.customer.updated',
      entityType: 'Customer',
      entityId: customerId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to update customer');
  }
}

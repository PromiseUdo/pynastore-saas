'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { getOrganizationEntitlements, hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { ItemType } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError, getAvailableStock } from './shared';

const KitComponentInputSchema = z.object({
  componentItemId: z.string().cuid(),
  quantity: z.number().positive(),
});

const CreateKitSchema = z.object({
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  unit: z.string().min(1).max(20).default('pcs'),
  categoryId: z.string().cuid().optional(),
  sellingPrice: z.number().nonnegative().optional(),
  components: z.array(KitComponentInputSchema).min(1, 'A kit needs at least one component'),
});

export async function createKit(
  input: z.infer<typeof CreateKitSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CREATE);

    const { plan } = await getOrganizationEntitlements();
    if (!hasFeature(plan, FEATURES.INVENTORY_KITS)) {
      return { success: false, error: 'Kits & assemblies require the Pro plan or higher' };
    }

    const data = CreateKitSchema.parse(input);

    const componentIds = data.components.map((c) => c.componentItemId);
    const components = await prisma.inventoryItem.findMany({
      where: { id: { in: componentIds } },
      select: { id: true, organizationId: true },
    });
    if (
      components.length !== componentIds.length ||
      components.some((c) => c.organizationId !== ctx.organization.id)
    ) {
      return { success: false, error: 'One or more components were not found' };
    }

    const kit = await prisma.$transaction(async (tx) => {
      const kitItem = await tx.inventoryItem.create({
        data: {
          organizationId: ctx.organization.id,
          sku: data.sku,
          name: data.name,
          description: data.description,
          unit: data.unit,
          categoryId: data.categoryId,
          sellingPrice: data.sellingPrice,
          itemType: ItemType.KIT,
        },
      });

      await tx.kitComponent.createMany({
        data: data.components.map((c) => ({
          kitItemId: kitItem.id,
          componentItemId: c.componentItemId,
          quantity: c.quantity,
        })),
      });

      return kitItem;
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.kit.created',
      entityType: 'InventoryItem',
      entityId: kit.id,
      metadata: { sku: data.sku, componentCount: data.components.length },
    });

    return { success: true, data: { id: kit.id } };
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return { success: false, error: 'A SKU with this value already exists' };
    }
    return toActionError(err, 'Failed to create kit');
  }
}

const AssembleKitSchema = z.object({
  kitItemId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  quantity: z.number().positive(),
});

export async function assembleKit(
  input: z.infer<typeof AssembleKitSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_KIT_ASSEMBLE);

    const { plan } = await getOrganizationEntitlements();
    if (!hasFeature(plan, FEATURES.INVENTORY_KITS)) {
      return { success: false, error: 'Kits & assemblies require the Pro plan or higher' };
    }

    const data = AssembleKitSchema.parse(input);

    const [kitItem, warehouse] = await Promise.all([
      prisma.inventoryItem.findUnique({
        where: { id: data.kitItemId },
        select: {
          id: true,
          organizationId: true,
          itemType: true,
          kitComponents: { select: { componentItemId: true, quantity: true } },
        },
      }),
      prisma.warehouse.findUnique({
        where: { id: data.warehouseId },
        select: { id: true, organizationId: true },
      }),
    ]);

    if (!kitItem || kitItem.organizationId !== ctx.organization.id || kitItem.itemType !== ItemType.KIT) {
      return { success: false, error: 'Kit not found' };
    }
    if (!warehouse || warehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }

    const requiredByComponent = kitItem.kitComponents.map((c) => ({
      componentItemId: c.componentItemId,
      required: Number(c.quantity) * data.quantity,
    }));

    // Available, not raw on-hand — a component already reserved by an issued
    // invoice awaiting packing can't be silently consumed into a kit.
    const availabilityByComponent = await Promise.all(
      requiredByComponent.map((req) =>
        getAvailableStock(prisma, { inventoryItemId: req.componentItemId, warehouseId: data.warehouseId }),
      ),
    );

    for (let i = 0; i < requiredByComponent.length; i++) {
      const req = requiredByComponent[i];
      const { available } = availabilityByComponent[i];
      if (available < req.required) {
        return { success: false, error: 'Insufficient available component stock to assemble this quantity (some may be reserved)' };
      }
    }

    const assembly = await prisma.$transaction(async (tx) => {
      for (const req of requiredByComponent) {
        await tx.stockMovement.create({
          data: {
            organizationId: ctx.organization.id,
            inventoryItemId: req.componentItemId,
            warehouseId: data.warehouseId,
            type: 'OUT',
            quantity: req.required,
            referenceType: 'KitAssembly',
            referenceId: data.kitItemId,
            performedById: ctx.userId,
          },
        });
        await tx.inventoryLevel.update({
          where: {
            inventoryItemId_warehouseId: {
              inventoryItemId: req.componentItemId,
              warehouseId: data.warehouseId,
            },
          },
          data: { quantity: { decrement: req.required } },
        });
      }

      const kitMovement = await tx.stockMovement.create({
        data: {
          organizationId: ctx.organization.id,
          inventoryItemId: data.kitItemId,
          warehouseId: data.warehouseId,
          type: 'IN',
          quantity: data.quantity,
          referenceType: 'KitAssembly',
          referenceId: data.kitItemId,
          performedById: ctx.userId,
        },
      });

      await tx.inventoryLevel.upsert({
        where: {
          inventoryItemId_warehouseId: {
            inventoryItemId: data.kitItemId,
            warehouseId: data.warehouseId,
          },
        },
        create: {
          inventoryItemId: data.kitItemId,
          warehouseId: data.warehouseId,
          quantity: data.quantity,
        },
        update: { quantity: { increment: data.quantity } },
      });

      return kitMovement;
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.kit.assembled',
      entityType: 'InventoryItem',
      entityId: data.kitItemId,
      metadata: { warehouseId: data.warehouseId, quantity: data.quantity },
    });

    return { success: true, data: { id: assembly.id } };
  } catch (err) {
    return toActionError(err, 'Failed to assemble kit');
  }
}

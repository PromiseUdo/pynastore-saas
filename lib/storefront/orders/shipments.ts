/*
 * lib/storefront/orders/shipments.ts
 *
 * The parcels of an online order (ROADMAP Phase 9.4): written from the
 * fulfilment plan when the order is placed (../delivery/plan.ts), and moved
 * along with the order until parcels are sent one by one (Phase 9.6).
 *
 * Each parcel records the store it leaves from, how it travels and what that
 * trip was charged, copied from the plan — so a merchant editing their rates
 * never rewrites history. The stock held for a parcel points at it
 * (OrderStockAllocation.shipmentId), which is how a store will later send
 * exactly its own part.
 *
 * Every function takes a transaction client: parcels are written and moved in
 * the same transaction as the order and its stock.
 */
import { Prisma } from '@/lib/generated/prisma/client';
import type { prisma } from '@/lib/prisma';
import type { PlannedShipment } from '../delivery/plan';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const toMajor = (minor: number) => new Prisma.Decimal(minor).dividedBy(100);

/**
 * Write a plan's parcels for an order, in the plan's order (the biggest
 * first). Returns their ids in the same order, for the stock hold to point at.
 */
export async function writeShipments(
  tx: Tx,
  input: { organizationId: string; orderId: string; shipments: PlannedShipment[] },
): Promise<string[]> {
  // One round trip for every parcel: the order transaction is already long.
  const created = await tx.orderShipment.createManyAndReturn({
    data: input.shipments.map(({ store, method }, index) => ({
      organizationId: input.organizationId,
      orderId: input.orderId,
      warehouseId: store.id,
      kind: method.kind === 'pickup' ? ('PICKUP' as const) : ('DELIVERY' as const),
      deliveryMethodId: method.id,
      deliveryMethodLabel: method.label,
      fee: toMajor(method.price),
      freeOverApplied: method.price === 0 && (method.regularPrice ?? 0) > 0,
      etaMinMinutes: method.eta.minMinutes,
      etaMaxMinutes: method.eta.maxMinutes,
      etaUnit: method.eta.unit,
      sortOrder: index,
    })),
    select: { id: true, sortOrder: true },
  });
  // Rows needn't come back in insert order; sortOrder is the plan's order.
  return created.sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.id);
}

/**
 * Forget an order's parcels that never left — for a late payment whose order
 * is re-planned (./stock.ts reReserveOrderStock). Only parcels still waiting
 * or cancelled; anything sent is history and stays.
 */
export async function clearUnsentShipments(tx: Tx, orderId: string): Promise<void> {
  await tx.orderShipment.deleteMany({ where: { orderId, status: { in: ['PENDING', 'CANCELLED'] }, dispatchedAt: null } });
}

/** The order was shipped: every parcel still waiting has left. */
export async function markShipmentsDispatched(tx: Tx, orderId: string, at: Date): Promise<void> {
  await tx.orderShipment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'DISPATCHED', dispatchedAt: at } });
}

/** The order was delivered: every parcel on its way has arrived. */
export async function markShipmentsDelivered(tx: Tx, orderId: string, at: Date): Promise<void> {
  await tx.orderShipment.updateMany({ where: { orderId, status: 'DISPATCHED' }, data: { status: 'DELIVERED', deliveredAt: at } });
}

/** The order was cancelled: nothing still waiting will go. */
export async function markShipmentsCancelled(tx: Tx, orderId: string): Promise<void> {
  await tx.orderShipment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
}

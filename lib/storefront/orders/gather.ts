/*
 * lib/storefront/orders/gather.ts
 *
 * Bringing an order together at one store (ROADMAP Phase 9.7).
 *
 * When a merchant sends a split bag as ONE parcel, the parcel's store holds
 * what it has and the rest is held at the stores that have it (the order's
 * allocations say where — see ./stock.ts plannedStockOf). From there:
 *
 *   1. CONFIRMED (paid online, transfer confirmed, or pay on delivery
 *      accepted) → a REQUESTED StockTransfer per store and product, linked to
 *      the order and parcel. Nothing moves yet, and nothing is asked of a
 *      store for an order nobody has committed to.
 *   2. The source store SENDS it (the Transfers screen) → the order's hold
 *      there is released and the units leave that shelf, as any transfer.
 *   3. The gathering store RECEIVES it → the units land on its shelf and are
 *      held for the order straight away, against the same parcel.
 *   4. Only when nothing is still requested or on its way can the parcel be
 *      sent (./lifecycle.ts).
 *
 * Cancelling the order cancels any transfer not yet sent; one already on its
 * way simply arrives as ordinary stock.
 *
 * Every function takes a transaction client, so each step commits with the
 * order change that caused it.
 */
import type { prisma } from '@/lib/prisma';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Ask the other stores for this order's gathered items. Safe to call more
 * than once: an order that already has its transfers gets no more.
 */
export async function requestGatheringTransfers(tx: Tx, orderId: string): Promise<number> {
  /* One round trip for the usual answer — nothing to gather: no stock held
   * for a parcel at a store other than the parcel's, or transfers already
   * raised. Every confirmation asks, so it has to be cheap. */
  const [{ needed }] = await tx.$queryRaw<{ needed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "order_stock_allocations" a
      JOIN "order_shipments" s ON s."id" = a."shipmentId"
      WHERE a."orderId" = ${orderId} AND a."status" = 'RESERVED' AND a."warehouseId" <> s."warehouseId"
    ) AND NOT EXISTS (SELECT 1 FROM "stock_transfers" t WHERE t."orderId" = ${orderId}) AS needed
  `;
  if (!needed) return 0;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      organizationId: true,
      reference: true,
      shipments: {
        where: { status: 'PENDING', warehouseId: { not: null } },
        select: {
          id: true,
          warehouseId: true,
          allocations: { where: { status: 'RESERVED' }, select: { warehouseId: true, inventoryItemId: true, quantity: true } },
        },
      },
    },
  });
  if (!order) return 0;

  let created = 0;
  const now = new Date();
  for (const shipment of order.shipments) {
    const wanted = new Map<string, { from: string; itemId: string; quantity: number }>();
    for (const a of shipment.allocations) {
      if (a.warehouseId === shipment.warehouseId) continue;
      const key = `${a.warehouseId}:${a.inventoryItemId}`;
      const entry = wanted.get(key) ?? { from: a.warehouseId, itemId: a.inventoryItemId, quantity: 0 };
      entry.quantity += Number(a.quantity);
      wanted.set(key, entry);
    }
    for (const entry of wanted.values()) {
      await tx.stockTransfer.create({
        data: {
          organizationId: order.organizationId,
          inventoryItemId: entry.itemId,
          fromWarehouseId: entry.from,
          toWarehouseId: shipment.warehouseId!,
          quantity: entry.quantity,
          status: 'REQUESTED',
          requestedAt: now,
          orderId,
          shipmentId: shipment.id,
          notes: `For order ${order.reference} — sent on together from the receiving store`,
        },
      });
      created += 1;
    }
  }
  return created;
}

/** The order was cancelled: nothing still only asked for will be sent. */
export async function cancelRequestedTransfers(tx: Tx, orderId: string): Promise<void> {
  await tx.stockTransfer.updateMany({ where: { orderId, status: 'REQUESTED' }, data: { status: 'CANCELLED' } });
}

/** The stores this parcel is still waiting on — asked for, or on their way. */
export async function waitingOn(tx: Tx, where: { orderId: string; shipmentId?: string }): Promise<string[]> {
  const pending = await tx.stockTransfer.findMany({
    where: { ...where, status: { in: ['REQUESTED', 'DISPATCHED'] } },
    select: { fromWarehouse: { select: { name: true } } },
  });
  return [...new Set(pending.map((t) => t.fromWarehouse.name))];
}

export class GatherTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatherTransferError';
  }
}

/**
 * The source store sends an order's requested transfer: the order's hold
 * there is released and the units leave the shelf, in one step, so they are
 * never counted twice or not at all.
 */
export async function sendRequestedTransfer(
  tx: Tx,
  input: { organizationId: string; transferId: string; performedById: string | null },
): Promise<void> {
  const transfer = await tx.stockTransfer.findFirst({
    where: { id: input.transferId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      orderId: true,
      shipmentId: true,
      inventoryItemId: true,
      fromWarehouseId: true,
      quantity: true,
      order: { select: { status: true } },
    },
  });
  if (!transfer) throw new GatherTransferError('Transfer not found');
  if (transfer.status !== 'REQUESTED') throw new GatherTransferError('This transfer has already been sent or cancelled.');
  if (!transfer.orderId || transfer.order?.status === 'CANCELLED') {
    throw new GatherTransferError('The order this was for has been cancelled, so there is nothing to send.');
  }

  const claimed = await tx.stockTransfer.updateMany({
    where: { id: transfer.id, status: 'REQUESTED' },
    data: { status: 'DISPATCHED', dispatchedAt: new Date(), dispatchedById: input.performedById },
  });
  if (claimed.count === 0) throw new GatherTransferError('This transfer has already been sent or cancelled.');

  // The order's hold here goes with the units.
  const holds = await tx.orderStockAllocation.findMany({
    where: {
      orderId: transfer.orderId,
      shipmentId: transfer.shipmentId,
      inventoryItemId: transfer.inventoryItemId,
      warehouseId: transfer.fromWarehouseId,
      status: 'RESERVED',
    },
    select: { id: true, quantity: true },
  });
  const held = holds.reduce((sum, h) => sum + Number(h.quantity), 0);
  if (holds.length) {
    await tx.orderStockAllocation.updateMany({ where: { id: { in: holds.map((h) => h.id) } }, data: { status: 'RELEASED' } });
  }

  const quantity = Number(transfer.quantity);
  const moved = await tx.$executeRaw`
    UPDATE "inventory_levels"
    SET "reservedQty" = GREATEST("reservedQty" - ${held}, 0), "quantity" = "quantity" - ${quantity}, "updatedAt" = NOW()
    WHERE "inventoryItemId" = ${transfer.inventoryItemId} AND "warehouseId" = ${transfer.fromWarehouseId}
      AND "quantity" - GREATEST("reservedQty" - ${held}, 0) >= ${quantity}
  `;
  if (moved === 0) throw new GatherTransferError('There isn’t enough of this item on the shelf to send.');

  await tx.stockMovement.create({
    data: {
      organizationId: input.organizationId,
      inventoryItemId: transfer.inventoryItemId,
      warehouseId: transfer.fromWarehouseId,
      type: 'OUT',
      quantity,
      referenceType: 'StockTransfer',
      referenceId: transfer.id,
      notes: 'Sent on to bring an order together',
      performedById: input.performedById,
    },
  });
}

/**
 * The gathering store received an order's transfer: hold the units for the
 * order at once, against its parcel, so nobody else can buy them first.
 * Nothing to hold for an order that was cancelled or has already gone.
 */
export async function holdReceivedForOrder(
  tx: Tx,
  transfer: { id: string; organizationId: string; orderId: string | null; shipmentId: string | null; inventoryItemId: string; toWarehouseId: string; quantity: unknown },
): Promise<void> {
  if (!transfer.orderId || !transfer.shipmentId) return;
  const order = await tx.order.findUnique({
    where: { id: transfer.orderId },
    select: { status: true, lineItems: { select: { id: true, variantId: true, productId: true } } },
  });
  if (!order || !['PENDING', 'CONFIRMED', 'PROCESSING'].includes(order.status)) return;

  const line = order.lineItems.find(
    (l) => l.variantId === transfer.inventoryItemId || (!l.variantId && l.productId === transfer.inventoryItemId),
  );
  if (!line) return;

  const quantity = Number(transfer.quantity);
  const held = await tx.$executeRaw`
    UPDATE "inventory_levels"
    SET "reservedQty" = "reservedQty" + ${quantity}, "updatedAt" = NOW()
    WHERE "inventoryItemId" = ${transfer.inventoryItemId} AND "warehouseId" = ${transfer.toWarehouseId}
      AND "quantity" - "reservedQty" >= ${quantity}
  `;
  if (held === 0) return;

  await tx.orderStockAllocation.create({
    data: {
      organizationId: transfer.organizationId,
      orderId: transfer.orderId,
      orderLineItemId: line.id,
      inventoryItemId: transfer.inventoryItemId,
      warehouseId: transfer.toWarehouseId,
      shipmentId: transfer.shipmentId,
      quantity,
    },
  });
  await tx.stockMovement.create({
    data: {
      organizationId: transfer.organizationId,
      inventoryItemId: transfer.inventoryItemId,
      warehouseId: transfer.toWarehouseId,
      type: 'RESERVED',
      quantity,
      referenceType: 'Order',
      referenceId: transfer.orderId,
      notes: 'Held for an online order, brought here from another store',
    },
  });
}

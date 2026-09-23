/*
 * lib/storefront/orders/stock.ts
 *
 * Holding, releasing and sending the stock behind an online order.
 *
 * The HOLD is the one invoices already use: InventoryLevel.reservedQty.
 * Available stock everywhere in the app — the storefront's `onlineStock`,
 * the admin's getAvailableStock — is `quantity − reservedQty`, so once an
 * order holds a unit, no other shopper, invoice, transfer or manual stock-out
 * can take it.
 *
 * WHERE FROM: for an online order, only stores that sell online (the same
 * stores the storefront counts), fullest first, spilling into the next store
 * when one can't cover a line. For a counter sale, the one store the customer
 * is standing in — `warehouseId` — whether or not it sells online. Each
 * store's share is an OrderStockAllocation row, so releasing or dispatching
 * later touches exactly what was held.
 *
 * RACES: the hold is a conditional UPDATE — "add to reservedQty only if what
 * remains available still covers it" — so two shoppers after the last unit
 * can't both get it. The loser's transaction rolls back and they're told it
 * sold out; there is no read-then-write gap for them to fall through.
 *
 * Every function takes a transaction client: a hold must commit or roll back
 * together with the order it belongs to.
 */
import type { prisma } from '@/lib/prisma';

/** The client handed to a `prisma.$transaction` callback. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export class OutOfStockError extends Error {
  constructor(readonly inventoryItemId: string) {
    super(`Not enough stock to hold for ${inventoryItemId}`);
    this.name = 'OutOfStockError';
  }
}

export interface StockLine {
  orderLineItemId: string;
  inventoryItemId: string;
  quantity: number;
}

/**
 * Hold stock for every line, or throw OutOfStockError and hold nothing (the
 * caller's transaction rolls back).
 */
export async function reserveOrderStock(
  tx: Tx,
  input: {
    organizationId: string;
    orderId: string;
    lines: StockLine[];
    /**
     * Take it all from this one store (a counter sale). Without it, stock
     * comes from the stores that sell online, as the storefront counts them.
     */
    warehouseId?: string;
  },
): Promise<void> {
  for (const line of input.lines) {
    let remaining = line.quantity;

    const levels = await tx.inventoryLevel.findMany({
      where: {
        inventoryItemId: line.inventoryItemId,
        ...(input.warehouseId
          ? { warehouseId: input.warehouseId, warehouse: { organizationId: input.organizationId, status: 'ACTIVE' } }
          : { warehouse: { organizationId: input.organizationId, sellsOnline: true, status: 'ACTIVE' } }),
      },
      select: { id: true, warehouseId: true, quantity: true, reservedQty: true },
    });

    // Fullest store first, so a line is split across as few stores as possible.
    levels.sort(
      (a, b) =>
        Number(b.quantity) - Number(b.reservedQty) - (Number(a.quantity) - Number(a.reservedQty)),
    );

    for (const level of levels) {
      if (remaining <= 0) break;
      const available = Math.floor(Number(level.quantity) - Number(level.reservedQty));
      const take = Math.min(available, remaining);
      if (take <= 0) continue;

      // Conditional: re-checks availability at write time, under the row lock.
      const held = await tx.$executeRaw`
        UPDATE "inventory_levels"
        SET "reservedQty" = "reservedQty" + ${take}, "updatedAt" = NOW()
        WHERE "id" = ${level.id} AND "quantity" - "reservedQty" >= ${take}
      `;
      if (held === 0) continue; // someone got there first; try the next store

      await tx.orderStockAllocation.create({
        data: {
          organizationId: input.organizationId,
          orderId: input.orderId,
          orderLineItemId: line.orderLineItemId,
          inventoryItemId: line.inventoryItemId,
          warehouseId: level.warehouseId,
          quantity: take,
        },
      });

      // A ledger note, like an invoice's: RESERVED moves nothing physically.
      await tx.stockMovement.create({
        data: {
          organizationId: input.organizationId,
          inventoryItemId: line.inventoryItemId,
          warehouseId: level.warehouseId,
          type: 'RESERVED',
          quantity: take,
          referenceType: 'Order',
          referenceId: input.orderId,
          notes: input.warehouseId ? 'Held for a counter sale' : 'Held for an online order',
        },
      });

      remaining -= take;
    }

    if (remaining > 0) throw new OutOfStockError(line.inventoryItemId);
  }
}

/** Give back everything an order still holds. Safe to call twice. */
export async function releaseOrderStock(tx: Tx, orderId: string): Promise<number> {
  const held = await tx.orderStockAllocation.findMany({
    where: { orderId, status: 'RESERVED' },
    select: { id: true, inventoryItemId: true, warehouseId: true, quantity: true },
  });

  for (const allocation of held) {
    const claimed = await tx.orderStockAllocation.updateMany({
      where: { id: allocation.id, status: 'RESERVED' },
      data: { status: 'RELEASED' },
    });
    if (claimed.count === 0) continue;

    // GREATEST guards against a hold that someone already zeroed by hand.
    await tx.$executeRaw`
      UPDATE "inventory_levels"
      SET "reservedQty" = GREATEST("reservedQty" - ${allocation.quantity}, 0), "updatedAt" = NOW()
      WHERE "inventoryItemId" = ${allocation.inventoryItemId} AND "warehouseId" = ${allocation.warehouseId}
    `;
  }

  return held.length;
}

export interface DispatchedStock {
  inventoryItemId: string;
  warehouseId: string;
  previousQty: number;
  newQty: number;
}

/**
 * The parcel left: turn every hold into a real stock-out. Both `quantity`
 * and `reservedQty` come down and an OUT movement is written, exactly as
 * packing an invoice does. Returns what moved, for low-stock alerts.
 */
export async function dispatchOrderStock(
  tx: Tx,
  input: { organizationId: string; orderId: string; performedById: string | null },
): Promise<DispatchedStock[]> {
  const held = await tx.orderStockAllocation.findMany({
    where: { orderId: input.orderId, status: 'RESERVED' },
    select: { id: true, inventoryItemId: true, warehouseId: true, quantity: true },
  });

  const moved: DispatchedStock[] = [];

  for (const allocation of held) {
    const claimed = await tx.orderStockAllocation.updateMany({
      where: { id: allocation.id, status: 'RESERVED' },
      data: { status: 'DISPATCHED' },
    });
    if (claimed.count === 0) continue;

    const level = await tx.inventoryLevel.update({
      where: {
        inventoryItemId_warehouseId: {
          inventoryItemId: allocation.inventoryItemId,
          warehouseId: allocation.warehouseId,
        },
      },
      data: {
        quantity: { decrement: allocation.quantity },
        reservedQty: { decrement: allocation.quantity },
      },
      select: { quantity: true },
    });

    await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        inventoryItemId: allocation.inventoryItemId,
        warehouseId: allocation.warehouseId,
        type: 'OUT',
        quantity: allocation.quantity,
        referenceType: 'Order',
        referenceId: input.orderId,
        notes: 'Sent to the customer',
        performedById: input.performedById,
      },
    });

    moved.push({
      inventoryItemId: allocation.inventoryItemId,
      warehouseId: allocation.warehouseId,
      previousQty: Number(level.quantity) + Number(allocation.quantity),
      newQty: Number(level.quantity),
    });
  }

  return moved;
}

/** Hold the stock for an order's lines again — for a payment that arrived after its hold lapsed. */
export async function reReserveOrderStock(tx: Tx, input: { organizationId: string; orderId: string }) {
  const lines = await tx.orderLineItem.findMany({
    where: { orderId: input.orderId },
    select: { id: true, variantId: true, productId: true, quantity: true },
  });

  await reserveOrderStock(tx, {
    organizationId: input.organizationId,
    orderId: input.orderId,
    lines: lines.map((line) => {
      const inventoryItemId = line.variantId ?? line.productId;
      if (!inventoryItemId) throw new OutOfStockError('deleted-product');
      return { orderLineItemId: line.id, inventoryItemId, quantity: line.quantity };
    }),
  });
}

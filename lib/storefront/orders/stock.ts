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
 * WHERE FROM: for an online order, exactly the stores its fulfilment plan
 * names (../delivery/plan.ts, ROADMAP Phase 9.3) — the stores whose delivery
 * the shopper was charged for. If a planned store can no longer cover its
 * share, the hold fails (OutOfStockError) and the order is refused; it never
 * quietly takes the units from another store, whose trip nobody paid for.
 * For a counter sale, the one store the customer is standing in —
 * `warehouseId` — whether or not it sells online. With neither, stock comes
 * from the stores that supply the online store, fullest first (kept for
 * callers that have no plan). Each
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
import { ONLINE_SUPPLY_WHERE } from '../delivery/supply';
import { quoteDelivery } from '../delivery/quote';
import { resolveDeliveryChoice } from '../delivery/plan';
import { clearUnsentShipments, writeShipments } from './shipments';

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
 * Where a plan sends each item from: itemId → [{ warehouseId, quantity,
 * shipmentId }] — the parcel it travels in, when the order's parcels have
 * been written (./shipments.ts).
 */
export type PlannedStock = Record<string, { warehouseId: string; quantity: number; shipmentId?: string }[]>;

/**
 * A fulfilment plan's parcels, flattened to what the hold needs. Pass the
 * parcels' ids (in plan order) so every hold points at its parcel.
 */
export function plannedStockOf(
  shipments: {
    store: { id: string };
    lines: { itemId: string; quantity: number }[];
    /** brought together (Phase 9.7): units held at other stores until they're sent here */
    sources?: { store: { id: string }; lines: { itemId: string; quantity: number }[] }[];
  }[],
  shipmentIds: string[] = [],
): PlannedStock {
  const planned: PlannedStock = {};
  for (const [index, shipment] of shipments.entries()) {
    const shipmentId = shipmentIds[index];
    // What other stores hold for this parcel is held THERE until it's sent on.
    const fromElsewhere = new Map<string, number>();
    for (const source of shipment.sources ?? []) {
      for (const line of source.lines) {
        (planned[line.itemId] ??= []).push({ warehouseId: source.store.id, quantity: line.quantity, shipmentId });
        fromElsewhere.set(line.itemId, (fromElsewhere.get(line.itemId) ?? 0) + line.quantity);
      }
    }
    for (const line of shipment.lines) {
      const here = line.quantity - (fromElsewhere.get(line.itemId) ?? 0);
      if (here > 0) (planned[line.itemId] ??= []).push({ warehouseId: shipment.store.id, quantity: here, shipmentId });
    }
  }
  return planned;
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
    /** An online order's plan: hold exactly here, or fail. */
    planned?: PlannedStock;
  },
): Promise<void> {
  if (input.planned) return reservePlanned(tx, { ...input, planned: input.planned });

  for (const line of input.lines) {
    let remaining = line.quantity;

    const levels = await tx.inventoryLevel.findMany({
      where: {
        inventoryItemId: line.inventoryItemId,
        ...(input.warehouseId
          ? { warehouseId: input.warehouseId, warehouse: { organizationId: input.organizationId, status: 'ACTIVE' } }
          : { warehouse: { organizationId: input.organizationId, ...ONLINE_SUPPLY_WHERE } }),
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

/** Hold one store's share of one line — conditionally, so a sold-out store fails rather than overselling. */
async function holdAt(
  tx: Tx,
  input: {
    organizationId: string;
    orderId: string;
    line: StockLine;
    warehouseId: string;
    quantity: number;
    note: string;
    shipmentId?: string;
  },
): Promise<boolean> {
  const held = await tx.$executeRaw`
    UPDATE "inventory_levels" l
    SET "reservedQty" = l."reservedQty" + ${input.quantity}, "updatedAt" = NOW()
    FROM "warehouses" w
    WHERE l."inventoryItemId" = ${input.line.inventoryItemId}
      AND l."warehouseId" = ${input.warehouseId}
      AND w."id" = l."warehouseId"
      AND w."organizationId" = ${input.organizationId}
      AND l."quantity" - l."reservedQty" >= ${input.quantity}
  `;
  if (held === 0) return false;

  await tx.orderStockAllocation.create({
    data: {
      organizationId: input.organizationId,
      orderId: input.orderId,
      orderLineItemId: input.line.orderLineItemId,
      inventoryItemId: input.line.inventoryItemId,
      warehouseId: input.warehouseId,
      shipmentId: input.shipmentId ?? null,
      quantity: input.quantity,
    },
  });
  await tx.stockMovement.create({
    data: {
      organizationId: input.organizationId,
      inventoryItemId: input.line.inventoryItemId,
      warehouseId: input.warehouseId,
      type: 'RESERVED',
      quantity: input.quantity,
      referenceType: 'Order',
      referenceId: input.orderId,
      notes: input.note,
    },
  });
  return true;
}

/**
 * Hold an online order's stock exactly where its plan says. Two order lines
 * for the same item draw on that item's planned shares in turn.
 */
async function reservePlanned(
  tx: Tx,
  input: { organizationId: string; orderId: string; lines: StockLine[]; planned: PlannedStock },
): Promise<void> {
  const shares = Object.fromEntries(
    Object.entries(input.planned).map(([itemId, list]) => [itemId, list.map((share) => ({ ...share }))]),
  );

  for (const line of input.lines) {
    let remaining = line.quantity;
    for (const share of shares[line.inventoryItemId] ?? []) {
      if (remaining <= 0) break;
      const take = Math.min(share.quantity, remaining);
      if (take <= 0) continue;
      const ok = await holdAt(tx, {
        organizationId: input.organizationId,
        orderId: input.orderId,
        line,
        warehouseId: share.warehouseId,
        shipmentId: share.shipmentId,
        quantity: take,
        note: 'Held for an online order',
      });
      if (!ok) throw new OutOfStockError(line.inventoryItemId);
      share.quantity -= take;
      remaining -= take;
    }
    // The plan didn't cover this line — never make up the difference elsewhere.
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
  input: {
    organizationId: string;
    orderId: string;
    performedById: string | null;
    /** only this parcel's stock (ROADMAP Phase 9.6); without it, everything still held */
    shipmentId?: string;
  },
): Promise<DispatchedStock[]> {
  const held = await tx.orderStockAllocation.findMany({
    where: { orderId: input.orderId, status: 'RESERVED', ...(input.shipmentId ? { shipmentId: input.shipmentId } : {}) },
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

/**
 * Hold the stock for an order's lines again — for a payment that arrived
 * after its hold lapsed.
 *
 * The delivery was already charged, so the order is re-planned (Phase 9.3)
 * and held only if the SAME delivery option still exists at the SAME fee:
 * the shopper paid for a trip, and holding from a store whose trip costs more
 * would ship at a loss. Otherwise it throws OutOfStockError and the payment
 * service leaves the order cancelled and paid, for staff to refund or sort
 * out — exactly as when the stock is simply gone.
 */
export async function reReserveOrderStock(tx: Tx, input: { organizationId: string; orderId: string }) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      deliveryMethodId: true,
      deliveryFee: true,
      shipState: true,
      shipCity: true,
      organization: { select: { slug: true } },
      lineItems: { select: { id: true, variantId: true, productId: true, quantity: true, unitPrice: true } },
    },
  });

  const lines = order.lineItems.map((line) => {
    const inventoryItemId = line.variantId ?? line.productId;
    if (!inventoryItemId) throw new OutOfStockError('deleted-product');
    return { orderLineItemId: line.id, inventoryItemId, quantity: line.quantity, unitPrice: Math.round(Number(line.unitPrice) * 100) };
  });

  const quote = await quoteDelivery(
    order.organization.slug,
    { state: order.shipState ?? '', city: order.shipCity ?? '' },
    lines.map((line) => ({ itemId: line.inventoryItemId, quantity: line.quantity, unitPrice: line.unitPrice })),
  );
  const chosen = order.deliveryMethodId ? resolveDeliveryChoice(quote, order.deliveryMethodId) : null;
  const paidFee = Math.round(Number(order.deliveryFee ?? 0) * 100);
  if (!chosen || chosen.method.price !== paidFee) throw new OutOfStockError('plan-changed');
  const { plan } = chosen;

  /* The new plan may send it from different stores than the first one did,
   * so its parcels are rewritten — none of them ever left (the order was
   * cancelled before it could ship). */
  await clearUnsentShipments(tx, input.orderId);
  const shipmentIds = await writeShipments(tx, {
    organizationId: input.organizationId,
    orderId: input.orderId,
    shipments: plan.shipments,
  });
  await reserveOrderStock(tx, {
    organizationId: input.organizationId,
    orderId: input.orderId,
    lines: lines.map(({ orderLineItemId, inventoryItemId, quantity }) => ({ orderLineItemId, inventoryItemId, quantity })),
    planned: plannedStockOf(plan.shipments, shipmentIds),
  });
}

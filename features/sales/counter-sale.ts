'use server';

/*
 * features/sales/counter-sale.ts
 *
 * A sale rung up by a member of staff: someone at the counter (WALK_IN), or
 * on the phone (PHONE).
 *
 * IT IS AN ORDER, deliberately (docs/ROADMAP.md Phase 2). Not a second
 * model, not an invoice pretending to be a receipt — the same `Order` the
 * storefront writes, with `channel` saying where it came from. That is what
 * makes "what did we sell today" one number, and it means returns, customer
 * history, stock allocation and every report cover the whole business
 * instead of the web half of it.
 *
 * WHAT IS DIFFERENT from an online order:
 *   - the goods leave immediately, so stock is reserved AND dispatched in the
 *     one transaction. There is no packing step to wait for.
 *   - the stock comes from ONE store — the one the customer is standing in —
 *     whether or not that store sells online.
 *   - there is no delivery, no shipping address, and often no customer at
 *     all. Those columns are null rather than blank (see the migration).
 *   - money has usually already changed hands, so it is recorded as PAID
 *     unless the merchant says the customer is paying later.
 *
 * PRICES ARE STILL RESOLVED HERE, from the merchant's own catalogue, even
 * though the browser sending them belongs to staff: a price that arrives
 * from a browser is a price a browser can edit. Staff may override a line's
 * price deliberately (haggling is normal), and that override is recorded as
 * a discount against the catalogue price rather than a silent overwrite.
 *
 * Needs `sales.order.create`.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requireStoreAccess, storeScopeWhere } from '@/lib/store-access';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { OutOfStockError, dispatchOrderStock, reserveOrderStock } from '@/lib/storefront/orders/stock';
import { alertLowStock } from '@/lib/storefront/orders/lifecycle';
import { searchSalesCustomers, searchSalesProducts } from './lookup';
import type { ActionResult } from './shared';

/** How the money arrived. `later` is the only one that isn't paid yet. */
const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'later'] as const;
export type CounterPaymentMethod = (typeof PAYMENT_METHODS)[number];

const CHANNELS = ['WALK_IN', 'PHONE'] as const;

const LineSchema = z.object({
  /** the InventoryItem being sold: a variant when the product has options */
  inventoryItemId: z.string().cuid(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(9999),
  /**
   * What staff actually charged, in major units. Omitted = the catalogue
   * price. Zero is allowed (a giveaway); negative is not.
   */
  unitPrice: z.number().nonnegative().optional(),
});

const CounterSaleSchema = z.object({
  channel: z.enum(CHANNELS).default('WALK_IN'),
  warehouseId: z.string().cuid('Choose which store this was sold from'),
  customerId: z.string().cuid().nullable().optional(),
  /** Taken down by hand when there's no customer record — all optional. */
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(32).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** A whole-sale discount in major units, on top of any per-line price. */
  discount: z.number().nonnegative().default(0),
  note: z.string().trim().max(1000).optional(),
  lines: z.array(LineSchema).min(1, 'Add at least one item'),
});

export type CounterSaleInput = z.input<typeof CounterSaleSchema>;

export interface CounterSaleResult {
  orderId: string;
  reference: string;
  totalAmount: number;
}

/** One sellable thing, as the sale screen searches for it. */
export interface SellableProduct {
  inventoryItemId: string;
  name: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  unitPrice: number;
  /** on hand less what is already held, in the chosen store */
  available: number;
}

export interface CounterStore {
  id: string;
  name: string;
}

/** An existing customer, as the till's search offers them. */
export interface CounterCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** orders they already have, so staff can tell two "Ada Obi"s apart */
  orderCount: number;
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to record a sale' };
  }
  if (error instanceof Error && error.name === 'StoreAccessDeniedError') {
    return { success: false, error: error.message };
  }
  console.error(`[counter-sale] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** The stores a sale can be rung up in. */
export async function listCounterStores(): Promise<ActionResult<CounterStore[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_ORDER_CREATE);

    /* A sale takes stock off a shelf, so the till offers only the stores this
     * member may work in — every store when they aren't scoped (Phase 8.6). */
    const stores = await prisma.warehouse.findMany({
      where: { organizationId: ctx.organization.id, status: 'ACTIVE', ...storeScopeWhere(ctx.membership) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: stores };
  } catch (error) {
    return failure(error, 'We couldn’t load your stores');
  }
}

/**
 * What is on the shelf in this store, by name, SKU or barcode — the shared
 * lookup, shaped for the till.
 */
export async function searchSellableProducts(
  warehouseId: string,
  query: string,
): Promise<ActionResult<SellableProduct[]>> {
  const result = await searchSalesProducts(warehouseId, query);
  if (!result.success) return result;
  return {
    success: true,
    data: result.data.map((item) => ({
      inventoryItemId: item.id,
      name: item.name,
      variantName: item.variantName,
      sku: item.sku,
      barcode: item.barcode,
      unitPrice: item.unitPrice,
      available: item.available,
    })),
  };
}

/**
 * The till's customer search — the shared one (features/sales/lookup.ts),
 * re-exported here so the screen has a single import and the search itself
 * has a single implementation.
 */
export async function searchCustomers(query: string): Promise<ActionResult<CounterCustomer[]>> {
  return searchSalesCustomers(query);
}

/**
 * The customer this sale belongs to, if any.
 *
 * Three outcomes, in order:
 *   - staff picked someone from the search → that person;
 *   - staff typed a name → a customer record is CREATED, because a shop
 *     owner who bothers to take a name wants it kept, and Phase 4's customer
 *     metrics count orders through this link;
 *   - nothing was typed → null. An anonymous cash sale is a real thing, and
 *     inventing a "Walk-in customer" row for it would put a ghost at the top
 *     of the customer list with every anonymous sale attached to it.
 *
 * An existing record is matched on PHONE only, never on name: two people
 * called Ada Obi are two people, and merging them silently would be worse
 * than a duplicate that Phase 4 can merge deliberately.
 */
async function resolveCustomer(
  organizationId: string,
  userId: string | null,
  input: { customerId?: string | null; customerName?: string; customerPhone?: string },
): Promise<{ id: string | null } | { error: string }> {
  if (input.customerId) {
    const existing = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId },
      select: { id: true },
    });
    return existing ? { id: existing.id } : { error: 'That customer isn’t in this workspace' };
  }

  const name = (input.customerName ?? '').trim();
  const phone = (input.customerPhone ?? '').trim();
  if (!name) return { id: null };

  if (phone) {
    const byPhone = await prisma.customer.findFirst({
      where: { organizationId, phone },
      select: { id: true },
    });
    if (byPhone) return { id: byPhone.id };
  }

  const created = await prisma.customer.create({
    data: { organizationId, name, phone: phone || null },
    select: { id: true },
  });

  await createAuditLog({
    organizationId,
    userId,
    action: 'sales.customer.created',
    entityType: 'Customer',
    entityId: created.id,
    metadata: { name, source: 'counter-sale' },
  });

  return { id: created.id };
}

/** ORD-2026-000123, continuing the same run the storefront uses. */
async function nextReference(organizationId: string, now: Date, skip: number): Promise<string> {
  const prefix = `ORD-${now.getFullYear()}-`;
  const latest = await prisma.order.findFirst({
    where: { organizationId, reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const last = latest ? Number.parseInt(latest.reference.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(last + 1 + skip).padStart(6, '0')}`;
}

export async function recordCounterSale(
  input: CounterSaleInput,
): Promise<ActionResult<CounterSaleResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_ORDER_CREATE);
    const organizationId = ctx.organization.id;

    const parsed = CounterSaleSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const data = parsed.data;

    const store = await prisma.warehouse.findFirst({
      where: { id: data.warehouseId, organizationId, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    if (!store) return { success: false, error: 'That store isn’t in this workspace' };
    /* The sale takes stock off this shop's shelf, so it is a write there — a
     * member limited to certain stores can only ring up sales in those
     * (ROADMAP Phase 8.6). */
    requireStoreAccess(ctx.membership, store.id, store.name);

    const customer = await resolveCustomer(organizationId, ctx.userId, data);
    if ('error' in customer) return { success: false, error: customer.error };

    /* Prices come from the catalogue, not the browser. A line may still be
     * sold for less (or more) if staff say so, but the catalogue price is
     * what an omitted price means. */
    const itemIds = [...new Set(data.lines.map((l) => l.inventoryItemId))];
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        parentItem: { select: { id: true, name: true, sellingPrice: true, slug: true } },
        slug: true,
      },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    if (itemIds.some((id) => !byId.has(id))) {
      return { success: false, error: 'One of those products is no longer available' };
    }

    const lines = data.lines.map((line) => {
      const item = byId.get(line.inventoryItemId)!;
      const catalogue = Number(item.sellingPrice ?? item.parentItem?.sellingPrice ?? 0);
      const unitPrice = line.unitPrice ?? catalogue;
      return {
        inventoryItemId: item.id,
        productId: item.parentItem?.id ?? item.id,
        variantId: item.parentItem ? item.id : null,
        name: item.parentItem?.name ?? item.name,
        variantName: item.parentItem ? item.name : null,
        sku: item.sku,
        slug: item.parentItem?.slug ?? item.slug,
        quantity: line.quantity,
        unitPrice,
        totalPrice: unitPrice * line.quantity,
      };
    });

    const subtotal = lines.reduce((sum, l) => sum + l.totalPrice, 0);
    const discount = Math.min(data.discount, subtotal);
    const totalAmount = subtotal - discount;

    const now = new Date();
    const paidNow = data.paymentMethod !== 'later';
    const name = (data.customerName ?? '').trim();
    const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);

    /* Retry on the reference's unique constraint: two tills can compute the
     * same sequence number in the same second, and only the database can
     * settle it. */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reference = await nextReference(organizationId, now, attempt);

      try {
        const created = await prisma.$transaction(async (tx) => {
          const order = await tx.order.create({
            data: {
              organizationId,
              channel: data.channel,
              warehouseId: store.id,
              soldByUserId: ctx.userId,
              customerId: customer.id,
              reference,

              /* It is done: paid for (or not) and carried out of the shop.
               * Both timestamps are now because both genuinely happened now
               * — nothing here is backdated. */
              status: 'DELIVERED',
              confirmedAt: now,
              deliveredAt: now,
              paymentStatus: paidNow ? 'PAID' : 'AWAITING_PAYMENT',
              paidAt: paidNow ? now : null,
              paymentMethod: data.paymentMethod,
              /* "Guest" means nobody is attached to it — the same thing it
               * means on the storefront. */
              isGuest: customer.id === null,

              firstName: firstName ?? null,
              lastName: rest.length ? rest.join(' ') : null,
              phone: (data.customerPhone ?? '').trim() || null,

              currency: ctx.organization.currency,
              subtotal,
              discount,
              /* Tax is not charged at the counter until an org can say
               * whether it is registered for VAT — Phase 7. Zero is the
               * honest value, not a guess. */
              taxAmount: 0,
              totalAmount,

              note: data.note?.trim() || null,
              placedAt: now,

              lineItems: {
                create: lines.map((l) => ({
                  productId: l.productId,
                  variantId: l.variantId,
                  name: l.name,
                  variantName: l.variantName,
                  sku: l.sku,
                  slug: l.slug,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  totalPrice: l.totalPrice,
                })),
              },
            },
            select: { id: true, lineItems: { select: { id: true, productId: true, variantId: true, quantity: true } } },
          });

          /* Hold it, then send it, in the same breath: the customer is
           * already holding the goods. Reserving first is not ceremony — it
           * is the conditional update that stops two tills selling the last
           * one, and dispatch only converts what was actually held. */
          await reserveOrderStock(tx, {
            organizationId,
            orderId: order.id,
            warehouseId: store.id,
            lines: order.lineItems.map((line) => ({
              orderLineItemId: line.id,
              inventoryItemId: line.variantId ?? line.productId!,
              quantity: line.quantity,
            })),
          });

          const moved = await dispatchOrderStock(tx, {
            organizationId,
            orderId: order.id,
            performedById: ctx.userId,
          });

          return { orderId: order.id, moved };
        });

        await createAuditLog({
          organizationId,
          userId: ctx.userId,
          action: 'sales.order.created',
          entityType: 'Order',
          entityId: created.orderId,
          metadata: {
            channel: data.channel,
            reference,
            store: store.name,
            totalAmount,
            paymentMethod: data.paymentMethod,
            lineCount: lines.length,
          },
        });

        /* Selling the last few off a shelf is exactly when someone should
         * hear about it. Outside the transaction: a failed email must not
         * undo a sale that has already happened. */
        await alertLowStock(
          { organizationId, organizationSlug: ctx.organization.slug },
          created.moved,
        ).catch((error) => console.error('[counter-sale] low stock alert failed:', error));

        return { success: true, data: { orderId: created.orderId, reference, totalAmount } };
      } catch (error) {
        if (error instanceof OutOfStockError) {
          const item = byId.get(error.inventoryItemId);
          return {
            success: false,
            error: `There isn’t enough ${item?.name ?? 'stock'} in ${store.name} to sell that many`,
          };
        }
        // A clash on (organizationId, reference): take the next number.
        if (isReferenceClash(error) && attempt < 4) continue;
        throw error;
      }
    }

    return { success: false, error: 'We couldn’t save that sale. Please try again.' };
  } catch (error) {
    return failure(error, 'We couldn’t record that sale');
  }
}

function isReferenceClash(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

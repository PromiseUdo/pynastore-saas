'use server';

/*
 * features/sales/lookup.ts
 *
 * The searches behind every "who is this for?" and "what's on it?" box in
 * sales: the till, the invoice form, and anything after them.
 *
 * WHY THESE EXIST: these forms used to be handed the whole customer list and
 * the whole catalogue as `<Select>` options, loaded into the page on every
 * visit. That is fine with twelve products and unusable with twelve hundred —
 * there is no way to search a select, and the browser downloads every
 * customer's name to fill one dropdown. Searching in the database is both
 * faster and the only version that still works when the shop grows.
 *
 * PERMISSION: `sales.view`. Looking something up to put it on a document is
 * not the same act as creating the document — each action still checks its
 * own permission when it writes. Counter staff hold `sales.view` without
 * `customer.view`, and they need to be able to attach a regular to a sale.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import type { ActionResult } from './shared';

/** How many matches a picker shows before asking for a narrower search. */
const LIMIT = 10;

export interface CustomerMatch {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** what they've bought before — enough to tell two similar names apart */
  orderCount: number;
}

/**
 * A whole product, as a campaign picker offers it.
 *
 * Deliberately NOT the same shape as ProductMatch: that one finds the thing
 * with a shelf (a variant), because a till sells a specific size. A campaign
 * prices the PRODUCT — a merchant putting a skirt on sale means the skirt,
 * not size S — so this returns the parent and says what its variants cost.
 */
export interface CatalogueProductMatch {
  id: string;
  name: string;
  sku: string;
  /** cheapest and dearest of its variants, or its own price when it has none */
  priceFrom: number;
  priceTo: number;
  variantCount: number;
}

export interface ProductMatch {
  id: string;
  name: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  unitPrice: number;
  /** on hand less what is already held, in the store asked about; 0 when no store was named */
  available: number;
  /** drop-shipping needs one; the form says so rather than failing later */
  preferredSupplierId: string | null;
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to look that up' };
  }
  console.error(`[sales lookup] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** Someone who already has a record here — including an online-only shopper. */
export async function searchSalesCustomers(query: string): Promise<ActionResult<CustomerMatch[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const q = query.trim();
    if (q.length < 2) return { success: true, data: [] };

    const customers = await prisma.customer.findMany({
      where: {
        organizationId: ctx.organization.id,
        status: 'ACTIVE',
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: LIMIT,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, phone: true, _count: { select: { orders: true } } },
    });

    return {
      success: true,
      data: customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        orderCount: c._count.orders,
      })),
    };
  } catch (error) {
    return failure(error, 'We couldn’t search your customers');
  }
}

/**
 * Something to put on a line, by name, SKU or barcode.
 *
 * `warehouseId` decides which shelf `available` counts — what matters on an
 * invoice is whether the fulfillment store can cover it, and at a till
 * whether the shop floor can. Pass null when stock is beside the point: a
 * campaign prices the product itself, not one store's stock of it, and
 * showing a shelf count there would invite the wrong question.
 *
 * A product with variants never matches: its variants are the things with a
 * price and a shelf.
 *
 * Publish state is deliberately not a filter. A product that isn't on the
 * website is still perfectly sellable in a shop or on an invoice.
 */
export async function searchSalesProducts(
  warehouseId: string | null,
  query: string,
): Promise<ActionResult<ProductMatch[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const q = query.trim();
    if (!q) return { success: true, data: [] };

    /* A store id from a browser is only ever used together with the org. */
    if (warehouseId) {
      const store = await prisma.warehouse.findFirst({
        where: { id: warehouseId, organizationId: ctx.organization.id },
        select: { id: true },
      });
      if (!store) return { success: false, error: 'That store isn’t in this workspace' };
    }

    const items = await prisma.inventoryItem.findMany({
      where: {
        organizationId: ctx.organization.id,
        status: 'ACTIVE',
        variants: { none: {} },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { barcode: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: LIMIT,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        sellingPrice: true,
        preferredSupplierId: true,
        parentItem: { select: { name: true, sellingPrice: true } },
        inventoryLevels: warehouseId
          ? { where: { warehouseId }, select: { quantity: true, reservedQty: true } }
          : false,
      },
    });

    return {
      success: true,
      data: items.map((item) => {
        const level = 'inventoryLevels' in item ? item.inventoryLevels[0] : undefined;
        const price = item.sellingPrice ?? item.parentItem?.sellingPrice ?? null;
        return {
          id: item.id,
          // A variant's own name is its options; the product's name is the parent's.
          name: item.parentItem?.name ?? item.name,
          variantName: item.parentItem ? item.name : null,
          sku: item.sku,
          barcode: item.barcode,
          unitPrice: price === null ? 0 : Number(price),
          available: level ? Math.max(0, Number(level.quantity) - Number(level.reservedQty)) : 0,
          preferredSupplierId: item.preferredSupplierId,
        };
      }),
    };
  } catch (error) {
    return failure(error, 'We couldn’t search your products');
  }
}

/**
 * Products to put on sale, by name or SKU.
 *
 * Top-level products only — the thing a merchant names when they say "put
 * this on sale". Pricing one covers every variant it has, and the campaign
 * preview then lists each of those with its own before-and-after price, so
 * nothing about that is hidden.
 *
 * Published only, because an unpublished product cannot be bought and would
 * pad every count on the campaign page.
 */
export async function searchCatalogueProducts(query: string): Promise<ActionResult<CatalogueProductMatch[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const q = query.trim();
    if (!q) return { success: true, data: [] };

    const items = await prisma.inventoryItem.findMany({
      where: {
        organizationId: ctx.organization.id,
        status: 'ACTIVE',
        parentItemId: null,
        isPublished: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { barcode: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: LIMIT,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        variants: { where: { status: 'ACTIVE' }, select: { sellingPrice: true } },
      },
    });

    return {
      success: true,
      data: items.map((item) => {
        const base = item.sellingPrice === null ? 0 : Number(item.sellingPrice);
        // A variant with no price of its own inherits the parent's — the same
        // rule the storefront mapper and the campaign resolver use.
        const prices = item.variants.length
          ? item.variants.map((v) => (v.sellingPrice === null ? base : Number(v.sellingPrice)))
          : [base];
        return {
          id: item.id,
          name: item.name,
          sku: item.sku,
          priceFrom: Math.min(...prices),
          priceTo: Math.max(...prices),
          variantCount: item.variants.length,
        };
      }),
    };
  } catch (error) {
    return failure(error, 'We couldn’t search your products');
  }
}

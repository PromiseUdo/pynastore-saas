'use server';

/*
 * features/inventory/product-import.ts
 *
 * Importing products from a spreadsheet (ROADMAP 14.2). Two steps, both
 * given the same file:
 *   1. previewProductImport — reads the file against this workspace (SKUs
 *      already in use, categories, brands, stores, what the importer may do)
 *      and says, per product, whether it will be imported and what's wrong.
 *      Writes nothing.
 *   2. importProducts — checks it all again (the preview is never trusted),
 *      then creates each ready product through createProduct, so every rule,
 *      audit entry and image-search step that applies to a product made by
 *      hand applies here too, and records its opening stock as ordinary
 *      "stock received" entries in the ledger (createStockMovement).
 *
 * A product with a problem is skipped and the rest go in; a problem with the
 * file itself (an unknown store, stock nobody may record) stops the lot.
 * Imported products are drafts: they need photos before they can be
 * published, and the spreadsheet can't carry photos.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext, type OrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { canUseStore } from '@/lib/store-access';
import { parseProductImport, type ImportProduct } from '@/lib/inventory/product-import';
import { slugify } from './category-tree';
import { createProduct, type ProductInput } from './products';
import { createStockMovement } from './stock';
import type { ActionResult } from './shared';

export interface ImportPreviewProduct {
  rows: number[];
  name: string;
  sku: string;
  variantCount: number;
  priceMin: number | null;
  priceMax: number | null;
  /** opening stock, all stores */
  stockTotal: number;
  category: string | null;
  ready: boolean;
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  fileErrors: string[];
  fileWarnings: string[];
  products: ImportPreviewProduct[];
  summary: { rows: number; ready: number; skipped: number; variants: number; stockLines: number };
}

export interface ImportResult {
  created: number;
  stockLines: number;
  skipped: number;
  failures: { name: string; rows: number[]; error: string }[];
}

type StockLine = { sku: string; warehouseId: string; quantity: number; unitCost?: number };
type Plan = { preview: ImportPreviewProduct; input: ProductInput | null; stock: StockLine[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function analyse(ctx: OrganizationContext, text: string): Promise<{ preview: ImportPreview; plans: Plan[] }> {
  const organizationId = ctx.organization.id;
  const perms = ctx.membership.role.permissions;
  const parsed = parseProductImport(text);
  const fileErrors = [...parsed.fileErrors];
  const fileWarnings = [...parsed.fileWarnings];

  const allSkus = parsed.products.flatMap((p) => [p.sku, ...p.units.map((u) => u.sku)]).filter((s): s is string => Boolean(s));
  const [stores, categories, brands, existing] = await Promise.all([
    prisma.warehouse.findMany({ where: { organizationId, status: 'ACTIVE' }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { organizationId }, select: { id: true, name: true, parentId: true } }),
    prisma.brand.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    allSkus.length
      ? prisma.inventoryItem.findMany({ where: { organizationId, sku: { in: allSkus, mode: 'insensitive' } }, select: { sku: true } })
      : Promise.resolve([] as { sku: string }[]),
  ]);

  // Stores named in "Stock:" columns must exist, and the importer must be
  // allowed to record stock there — otherwise stock would be lost silently.
  const storeByName = new Map(stores.map((s) => [norm(s.name), s]));
  const stockStoreIds = new Map<string, string>();
  const hasStock = parsed.products.some((p) => p.units.some((u) => u.stock.length > 0));
  for (const name of parsed.stockStores) {
    const store = storeByName.get(norm(name));
    if (!store) fileErrors.push(`There’s no store called “${name}”. Check the spelling in the “Stock: ${name}” heading, or create the store first.`);
    else if (!canUseStore(ctx.membership, store.id)) fileErrors.push(`You can’t record stock at ${store.name}. Remove that column, or ask an owner to give you access.`);
    else stockStoreIds.set(norm(name), store.id);
  }
  if (hasStock && !hasPermission(perms, PERMISSIONS.INVENTORY_MOVEMENT_CREATE)) {
    fileErrors.push('You can add products but not record stock. Remove the “Stock:” columns, or ask an owner for permission to record stock.');
  }

  // Categories by their path ("Women > Dresses") or, when unambiguous, by name.
  const byId = new Map(categories.map((c) => [c.id, c]));
  const pathOf = (id: string): string => {
    const names: string[] = [];
    let c = byId.get(id);
    const seen = new Set<string>();
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      names.unshift(c.name);
      c = c.parentId ? byId.get(c.parentId) : undefined;
    }
    return names.join(' > ');
  };
  const categoryByPath = new Map(categories.map((c) => [norm(pathOf(c.id)), { id: c.id, label: pathOf(c.id) }]));
  const nameCounts = new Map<string, number>();
  for (const c of categories) nameCounts.set(norm(c.name), (nameCounts.get(norm(c.name)) ?? 0) + 1);
  const findCategory = (raw: string) => {
    const key = norm(raw.replace(/\s*[>/]\s*/g, ' > '));
    const byPath = categoryByPath.get(key);
    if (byPath) return byPath;
    if (nameCounts.get(key) === 1) {
      const c = categories.find((x) => norm(x.name) === key)!;
      return { id: c.id, label: pathOf(c.id) };
    }
    return null;
  };
  const brandByName = new Map(brands.map((b) => [norm(b.name), b]));
  const taken = new Set(existing.map((e) => e.sku.toLowerCase()));

  // A product with variants and no "Product SKU" gets one made from its name.
  const fileSkus = new Set(allSkus.map((s) => s.toLowerCase()));
  const generatedBases = parsed.products.filter((p) => !p.sku).map((p) => (slugify(p.name).toUpperCase() || 'PRODUCT').slice(0, 50));
  const candidateSkus = generatedBases.flatMap((b) => [b, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${b}-${n}`)]);
  const takenGenerated = candidateSkus.length
    ? new Set(
        (
          await prisma.inventoryItem.findMany({
            where: { organizationId, sku: { in: candidateSkus, mode: 'insensitive' } },
            select: { sku: true },
          })
        ).map((r) => r.sku.toLowerCase()),
      )
    : new Set<string>();
  const generateSku = (name: string) => {
    const base = (slugify(name).toUpperCase() || 'PRODUCT').slice(0, 50);
    for (const candidate of [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}-${n}`)]) {
      const k = candidate.toLowerCase();
      if (!fileSkus.has(k) && !takenGenerated.has(k)) {
        fileSkus.add(k);
        return candidate;
      }
    }
    return null;
  };

  const plans: Plan[] = parsed.products.map((p: ImportProduct) => {
    const errors = [...p.errors];
    const warnings = [...p.warnings];
    for (const s of [p.sku, ...p.units.map((u) => u.sku)]) {
      if (s && taken.has(s.toLowerCase())) errors.push(`SKU “${s}” is already used by a product in your workspace. Updating products by import isn’t available yet.`);
    }
    const sku = p.sku ?? generateSku(p.name);
    if (!sku) errors.push('Add a “Product SKU” for this product.');

    let categoryId: string | null = null;
    let category: string | null = null;
    if (p.category) {
      const found = findCategory(p.category);
      if (found) ({ id: categoryId, label: category } = found);
      else warnings.push(`There’s no category “${p.category}” — it will be imported without one.`);
    }
    let brandId: string | null = null;
    if (p.brand) {
      const found = brandByName.get(norm(p.brand));
      if (found) brandId = found.id;
      else warnings.push(`There’s no brand “${p.brand}” — it will be imported without one.`);
    }

    const prices = p.units.map((u) => u.price).filter((x): x is number => x !== null && !Number.isNaN(x));
    const stock: StockLine[] = p.units.flatMap((u) =>
      u.stock
        .map((s) => ({ sku: u.sku, warehouseId: stockStoreIds.get(norm(s.store)) ?? '', quantity: s.quantity, unitCost: u.costPrice ?? undefined }))
        .filter((s) => s.warehouseId),
    );
    const variants = p.options.length > 0;
    const ready = errors.length === 0;
    const preview: ImportPreviewProduct = {
      rows: p.rows,
      name: p.name,
      sku: sku ?? '—',
      variantCount: variants ? p.units.length : 0,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      stockTotal: stock.reduce((n, s) => n + s.quantity, 0),
      category,
      ready,
      errors,
      warnings,
    };
    const first = p.units[0];
    const input: ProductInput | null =
      ready && sku
        ? {
            name: p.name,
            sku,
            barcode: variants ? null : first.barcode,
            unit: p.unit || 'pcs',
            description: p.description,
            categoryId,
            brandId,
            reorderPoint: p.reorderPoint,
            sellingPrice: variants ? (prices[0] ?? null) : first.price,
            compareAtPrice: variants ? null : first.compareAtPrice,
            isPublished: false,
            options: p.options,
            variants: variants
              ? p.units.map((u) => ({
                  sku: u.sku,
                  barcode: u.barcode,
                  attributes: u.attributes,
                  sellingPrice: u.price,
                  compareAtPrice: u.compareAtPrice,
                }))
              : [],
          }
        : null;
    return { preview, input, stock };
  });

  const ready = plans.filter((x) => x.preview.ready);
  return {
    preview: {
      fileErrors,
      fileWarnings,
      products: plans.map((x) => x.preview),
      summary: {
        rows: parsed.rowCount,
        ready: ready.length,
        skipped: plans.length - ready.length,
        variants: ready.reduce((n, x) => n + x.preview.variantCount, 0),
        stockLines: ready.reduce((n, x) => n + x.stock.length, 0),
      },
    },
    plans,
  };
}

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof PermissionDeniedError) return { success: false, error: 'You don’t have permission to add products.' };
  console.error(`[product-import] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** Reads the file and says what would happen. Writes nothing. */
export async function previewProductImport(text: string): Promise<ActionResult<ImportPreview>> {
  try {
    const ctx = await getOrganizationContext();
    if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CREATE)) {
      return { success: false, error: 'You don’t have permission to add products.' };
    }
    const { preview } = await analyse(ctx, String(text ?? ''));
    return { success: true, data: preview };
  } catch (error) {
    return denied(error, 'We couldn’t read that file. Check it’s a CSV and try again.');
  }
}

/** Imports the ready products and their opening stock; skips the rest. */
export async function importProducts(text: string): Promise<ActionResult<ImportResult>> {
  try {
    const ctx = await getOrganizationContext();
    if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CREATE)) {
      return { success: false, error: 'You don’t have permission to add products.' };
    }
    const { preview, plans } = await analyse(ctx, String(text ?? ''));
    if (preview.fileErrors.length) return { success: false, error: preview.fileErrors[0] };
    if (preview.summary.ready === 0) return { success: false, error: 'There’s nothing in this file that can be imported yet.' };

    const result: ImportResult = { created: 0, stockLines: 0, skipped: preview.summary.skipped, failures: [] };
    for (const plan of plans) {
      if (!plan.input) continue;
      const created = await createProduct(plan.input);
      if (!created.success) {
        result.failures.push({ name: plan.preview.name, rows: plan.preview.rows, error: created.error });
        continue;
      }
      result.created += 1;

      if (plan.stock.length) {
        const units = await prisma.inventoryItem.findMany({
          where: { organizationId: ctx.organization.id, sku: { in: plan.stock.map((s) => s.sku) } },
          select: { id: true, sku: true },
        });
        const idBySku = new Map(units.map((u) => [u.sku.toLowerCase(), u.id]));
        for (const line of plan.stock) {
          const inventoryItemId = idBySku.get(line.sku.toLowerCase());
          if (!inventoryItemId) continue;
          const moved = await createStockMovement({
            inventoryItemId,
            warehouseId: line.warehouseId,
            type: 'IN',
            quantity: line.quantity,
            unitCost: line.unitCost,
            notes: 'Opening stock (imported from a spreadsheet)',
          });
          if (moved.success) result.stockLines += 1;
          else result.failures.push({ name: plan.preview.name, rows: plan.preview.rows, error: `Created, but its stock wasn’t recorded: ${moved.error}` });
        }
      }
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.item.imported',
      entityType: 'InventoryItem',
      entityId: ctx.organization.id,
      metadata: { rows: preview.summary.rows, created: result.created, skipped: result.skipped, stockLines: result.stockLines, failed: result.failures.length },
    });
    return { success: true, data: result };
  } catch (error) {
    return denied(error, 'The import stopped part-way. Check your products list to see what was added, then try the rest again.');
  }
}

'use server';

/*
 * features/marketing/campaigns.ts
 *
 * Campaigns: a sale on chosen products, for a chosen stretch of time.
 *
 * THE DESIGN DECISION, written down because it is the whole thing:
 * scheduling a campaign RESOLVES its targets into a list of products and
 * writes one CampaignPrice row per product, snapshotting what each was
 * selling for. It never touches `InventoryItem.sellingPrice`.
 *
 *   - the real price survives the sale, so ending one restores it by itself;
 *   - the strike-through a shopper sees is what the shop was actually
 *     charging, not a number typed into a "compare at" box;
 *   - a later price edit can't silently move a live sale price;
 *   - and "what did this sale cost us" is answerable, because the before and
 *     after are both on the row.
 *
 * Resolving at schedule time also means the merchant can SEE exactly what
 * will change before it does — the difference between a sale and a surprise.
 *
 * Needs `sales.discount.manage`: a campaign is a discount with a calendar.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { campaignPriceFor } from '@/lib/marketing/campaign-rules';
import { slugify, uniqueSlug } from '@/features/inventory/category-tree';
import { destroyAsset, isOrgAsset } from '@/lib/cloudinary/sign';
import type { ActionResult } from '@/features/sales/shared';

const MECHANICS = ['PERCENT_OFF', 'FIXED_OFF'] as const;
const TARGET_KINDS = ['PRODUCT', 'COLLECTION', 'CATEGORY', 'STORE'] as const;

const CampaignSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the campaign a name').max(80),
    description: z.string().trim().max(500).optional(),
    mechanic: z.enum(MECHANICS),
    value: z.number().positive('The discount must be more than zero'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable().optional(),
    targetKind: z.enum(TARGET_KINDS),
    targetIds: z.array(z.string().cuid()).default([]),
  })
  .refine((data) => !(data.mechanic === 'PERCENT_OFF' && data.value > 100), {
    message: 'A percentage discount can’t be more than 100%',
    path: ['value'],
  })
  .refine((data) => !data.endsAt || data.endsAt > data.startsAt, {
    message: 'The end date has to be after the start date',
    path: ['endsAt'],
  })
  .refine((data) => data.targetKind === 'STORE' || data.targetIds.length > 0, {
    message: 'Choose what the campaign applies to',
    path: ['targetIds'],
  });

export type CampaignInput = z.input<typeof CampaignSchema>;

export interface CampaignPricePreview {
  inventoryItemId: string;
  name: string;
  sku: string;
  originalPrice: number;
  price: number;
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to manage campaigns' };
  }
  console.error(`[campaigns] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/**
 * Which products a campaign covers.
 *
 * Only things actually for sale online: an unpublished product in a targeted
 * category is not put on sale, because nobody can buy it and it would inflate
 * every count on the campaign page.
 *
 * Variants are priced individually — a variant is the thing with a price and
 * a shelf — and a product without variants is priced on itself.
 */
async function resolveTargets(
  organizationId: string,
  targetKind: (typeof TARGET_KINDS)[number],
  targetIds: string[],
): Promise<{ id: string; name: string; sku: string; price: number }[]> {
  const sellable = { organizationId, status: 'ACTIVE' as const };
  let parentIds: string[] = [];

  if (targetKind === 'STORE') {
    parentIds = (
      await prisma.inventoryItem.findMany({
        where: { ...sellable, parentItemId: null, isPublished: true },
        select: { id: true },
      })
    ).map((i) => i.id);
  } else if (targetKind === 'PRODUCT') {
    /*
     * A target id is normally a top-level product, but accept a VARIANT id
     * too and resolve it through its parent.
     *
     * Not defensiveness for its own sake: the picker used to offer variants
     * (the thing with a shelf, which is right for a till and wrong here), so
     * a campaign could be saved holding a variant id — and every such
     * campaign priced nothing at all, with only "nothing would change price"
     * to explain it. Resolving either kind means an old draft still works.
     */
    const chosen = await prisma.inventoryItem.findMany({
      where: { ...sellable, id: { in: targetIds } },
      select: { id: true, parentItemId: true },
    });
    const wantedParents = [...new Set(chosen.map((item) => item.parentItemId ?? item.id))];

    parentIds = (
      await prisma.inventoryItem.findMany({
        where: { ...sellable, parentItemId: null, isPublished: true, id: { in: wantedParents } },
        select: { id: true },
      })
    ).map((i) => i.id);
  } else if (targetKind === 'COLLECTION') {
    const items = await prisma.collectionItem.findMany({
      where: { collectionId: { in: targetIds }, collection: { organizationId } },
      select: { inventoryItemId: true },
    });
    const ids = [...new Set(items.map((i) => i.inventoryItemId))];
    parentIds = (
      await prisma.inventoryItem.findMany({
        where: { ...sellable, parentItemId: null, isPublished: true, id: { in: ids } },
        select: { id: true },
      })
    ).map((i) => i.id);
  } else {
    /* A category takes its descendants with it: putting "Fashion" on sale and
     * finding "Fashion → Skirts" at full price would be a bug to a shop
     * owner, whatever the data model says. */
    const all = await prisma.category.findMany({
      where: { organizationId },
      select: { id: true, parentId: true },
    });
    const wanted = new Set(targetIds);
    let grew = true;
    while (grew) {
      grew = false;
      for (const category of all) {
        if (category.parentId && wanted.has(category.parentId) && !wanted.has(category.id)) {
          wanted.add(category.id);
          grew = true;
        }
      }
    }
    parentIds = (
      await prisma.inventoryItem.findMany({
        where: { ...sellable, parentItemId: null, isPublished: true, categoryId: { in: [...wanted] } },
        select: { id: true },
      })
    ).map((i) => i.id);
  }

  if (parentIds.length === 0) return [];

  const products = await prisma.inventoryItem.findMany({
    where: { id: { in: parentIds } },
    select: {
      id: true,
      name: true,
      sku: true,
      sellingPrice: true,
      variants: {
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, sku: true, sellingPrice: true },
      },
    },
  });

  const priced: { id: string; name: string; sku: string; price: number }[] = [];
  for (const product of products) {
    const basePrice = product.sellingPrice === null ? null : Number(product.sellingPrice);
    if (product.variants.length === 0) {
      if (basePrice) priced.push({ id: product.id, name: product.name, sku: product.sku, price: basePrice });
      continue;
    }
    for (const variant of product.variants) {
      // A variant with no price of its own inherits the parent's — the same
      // rule the storefront mapper uses.
      const price = variant.sellingPrice === null ? basePrice : Number(variant.sellingPrice);
      if (price) {
        priced.push({ id: variant.id, name: `${product.name} · ${variant.name}`, sku: variant.sku, price });
      }
    }
  }

  return priced;
}

/** What the campaign WOULD do — shown before anything is committed. */
export async function previewCampaignPrices(
  input: CampaignInput,
): Promise<ActionResult<{ prices: CampaignPricePreview[]; skipped: number }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE);

    const parsed = CampaignSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const data = parsed.data;

    const targets = await resolveTargets(ctx.organization.id, data.targetKind, data.targetIds);

    const prices: CampaignPricePreview[] = [];
    let skipped = 0;
    for (const target of targets) {
      const price = campaignPriceFor(target.price, data.mechanic, data.value);
      // A discount that changes nothing leaves the product out, rather than
      // listing it under a sale banner at its usual price.
      if (price === null) {
        skipped += 1;
        continue;
      }
      prices.push({
        inventoryItemId: target.id,
        name: target.name,
        sku: target.sku,
        originalPrice: target.price,
        price,
      });
    }

    return { success: true, data: { prices, skipped } };
  } catch (error) {
    return failure(error, 'We couldn’t work out those prices');
  }
}

export async function createCampaign(input: CampaignInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE);

    const parsed = CampaignSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const data = parsed.data;

    const campaign = await prisma.campaign.create({
      data: {
        organizationId: ctx.organization.id,
        name: data.name,
        description: data.description || null,
        mechanic: data.mechanic,
        value: data.value,
        startsAt: data.startsAt,
        endsAt: data.endsAt ?? null,
        targetKind: data.targetKind,
        targetIds: data.targetIds,
        status: 'DRAFT',
      },
      select: { id: true },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'marketing.campaign.created',
      entityType: 'Campaign',
      entityId: campaign.id,
      metadata: { name: data.name, mechanic: data.mechanic, value: data.value },
    });

    return { success: true, data: campaign };
  } catch (error) {
    return failure(error, 'We couldn’t create that campaign');
  }
}

/**
 * Fix the prices and let it run.
 *
 * This is the moment the sale becomes real: targets are resolved, each
 * product's current price is snapshotted, and the sale price written beside
 * it. From here the window alone decides whether it is live.
 */
export async function scheduleCampaign(campaignId: string): Promise<ActionResult<{ priced: number }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE);
    const organizationId = ctx.organization.id;

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        mechanic: true,
        value: true,
        targetKind: true,
        targetIds: true,
        endsAt: true,
      },
    });
    if (!campaign) return { success: false, error: 'Campaign not found' };
    if (campaign.status === 'CANCELLED') return { success: false, error: 'This campaign was cancelled' };
    if (campaign.endsAt && campaign.endsAt <= new Date()) {
      return { success: false, error: 'This campaign’s end date has already passed' };
    }

    const targets = await resolveTargets(
      organizationId,
      campaign.targetKind as (typeof TARGET_KINDS)[number],
      campaign.targetIds,
    );

    const rows = targets
      .map((target) => {
        const price = campaignPriceFor(
          target.price,
          campaign.mechanic as (typeof MECHANICS)[number],
          Number(campaign.value),
        );
        return price === null ? null : { inventoryItemId: target.id, originalPrice: target.price, price };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) {
      return {
        success: false,
        error: 'Nothing this campaign covers would actually change price. Check the products and the discount.',
      };
    }

    /* Re-pricing replaces the whole list, in one transaction: a campaign
     * half-priced is worse than one not priced at all. */
    await prisma.$transaction(async (tx) => {
      await tx.campaignPrice.deleteMany({ where: { campaignId, organizationId } });
      await tx.campaignPrice.createMany({
        data: rows.map((row) => ({ ...row, campaignId, organizationId })),
      });
      await tx.campaign.update({ where: { id: campaignId }, data: { status: 'SCHEDULED' } });
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'marketing.campaign.scheduled',
      entityType: 'Campaign',
      entityId: campaignId,
      metadata: { name: campaign.name, products: rows.length },
    });

    return { success: true, data: { priced: rows.length } };
  } catch (error) {
    return failure(error, 'We couldn’t schedule that campaign');
  }
}

/**
 * Stop it now.
 *
 * The prices go back by themselves — nothing was overwritten, so there is
 * nothing to restore. The CampaignPrice rows are kept, so the campaign's
 * report still knows what it was selling at.
 */
export async function endCampaign(campaignId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE);

    const now = new Date();
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: ctx.organization.id },
      select: { id: true, name: true, status: true, startsAt: true },
    });
    if (!campaign) return { success: false, error: 'Campaign not found' };

    await prisma.campaign.update({
      where: { id: campaignId },
      /* Not yet started: calling it off is a cancellation, not an early
       * finish — "ended" about something that never ran is a small lie in
       * the history. */
      data:
        campaign.startsAt > now
          ? { status: 'CANCELLED', endedAt: now }
          : { endsAt: now, endedAt: now },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: campaign.startsAt > now ? 'marketing.campaign.cancelled' : 'marketing.campaign.ended',
      entityType: 'Campaign',
      entityId: campaignId,
      metadata: { name: campaign.name },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t stop that campaign');
  }
}

/** Only a campaign that never ran can be deleted; anything else is history. */
export async function deleteCampaign(campaignId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE);

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: ctx.organization.id },
      select: { id: true, name: true, status: true, startsAt: true },
    });
    if (!campaign) return { success: false, error: 'Campaign not found' };
    if (campaign.status === 'SCHEDULED' && campaign.startsAt <= new Date()) {
      return { success: false, error: 'This campaign has already run. End it instead of deleting it.' };
    }

    await prisma.campaign.delete({ where: { id: campaign.id } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'marketing.campaign.deleted',
      entityType: 'Campaign',
      entityId: campaignId,
      metadata: { name: campaign.name },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t delete that campaign');
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Telling customers about it
 *
 * The discount is rarely the whole message. "Orders for sale items ship from
 * the 27th" is the sort of thing a merchant needs to say alongside a sale,
 * and had nowhere to say it.
 *
 * Every word is theirs. There is no default sentence and nothing is
 * generated: leaving the text empty turns the announcement off however the
 * style is set, which is the honest behaviour for a shop with nothing to
 * announce.
 * ──────────────────────────────────────────────────────────────────────── */

const HEX_OR_EMPTY = z
  .string()
  .trim()
  .regex(/^(#[0-9a-fA-F]{6})?$/, 'Use a colour like #b42318')
  .optional();

const AnnouncementSchema = z
  .object({
    style: z.enum(['NONE', 'BAR', 'MODAL']),
    text: z.string().trim().max(160, 'Keep it to 160 characters — it has one line to work in').optional(),
    detail: z.string().trim().max(600).optional(),
    cta: z.string().trim().max(40).optional(),
    href: z.string().trim().max(500).optional(),
    image: z.object({ url: z.string().url(), publicId: z.string() }).nullable().optional(),
    background: HEX_OR_EMPTY,
    foreground: HEX_OR_EMPTY,
    scroll: z.boolean().optional(),
  })
  .refine((data) => data.style === 'NONE' || Boolean(data.text?.trim()), {
    message: 'Write what you want customers to see',
    path: ['text'],
  })
  .refine((data) => !data.href?.trim() || data.href.trim().startsWith('/'), {
    message: 'Pick where it goes from the list — a link has to be a page on your store',
    path: ['href'],
  })
  .refine((data) => !data.cta?.trim() || Boolean(data.href?.trim()), {
    message: 'A button needs somewhere to go',
    path: ['href'],
  });

export type AnnouncementFormInput = z.input<typeof AnnouncementSchema>;

/**
 * Does this link actually go anywhere on this merchant's store?
 *
 * Shape is not enough. "/anniversary-deals" is a perfectly well-formed path
 * and a 404 — the kind a merchant finds out about from a customer who
 * followed it. The storefront serves exactly four kinds of address that an
 * announcement has any business pointing at, and each one names something
 * that either exists or doesn't.
 *
 * Only this store's own pages: an announcement sends a shopper deeper into
 * the shop, not out of it.
 */
async function destinationProblem(organizationId: string, href: string): Promise<string | null> {
  const path = href.trim();
  if (!path.startsWith('/')) return 'A link has to be a page on your store.';

  const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head, ...rest] = segments;

  if (path === '/products' || head === 'products') return null;

  /* "/sale" is a permanent alias that redirects to the "sale" collection,
   * so it is only a real destination if that collection exists — which is
   * exactly the trap a merchant falls into by typing it. */
  const collectionSlug =
    head === 'sale' && rest.length === 0 ? 'sale' : head === 'collections' && rest.length === 1 ? rest[0] : null;

  if (collectionSlug) {
    const found = await prisma.collection.findFirst({
      where: { organizationId, slug: collectionSlug, isVisible: true },
      select: { id: true },
    });
    return found ? null : 'That collection isn’t on your store. Pick one from the list.';
  }

  if (head === 'pages' && rest.length === 1) {
    const found = await prisma.storePage.findFirst({
      where: { organizationId, slug: rest[0], isPublished: true },
      select: { id: true },
    });
    return found ? null : 'That page isn’t published on your store. Pick one from the list.';
  }

  if (head === 'c' && rest.length > 0) {
    /* A category address is the chain of slugs down to it, so the last one
     * has to exist and sit under the one before it. */
    const categories = await prisma.category.findMany({
      where: { organizationId, isVisible: true },
      select: { id: true, slug: true, parentId: true },
    });
    let parentId: string | null = null;
    for (const slug of rest) {
      const match = categories.find((c) => c.slug === slug && c.parentId === parentId);
      if (!match) return 'That category isn’t on your store. Pick one from the list.';
      parentId = match.id;
    }
    return null;
  }

  return 'That isn’t a page on your store. Pick where it goes from the list.';
}

export async function updateCampaignAnnouncement(
  campaignId: string,
  input: AnnouncementFormInput,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE);

    const parsed = AnnouncementSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const data = parsed.data;

    /* Checked here and not only in the form: a link that 404s is a customer
     * following a sale banner into nothing. */
    if (data.href?.trim()) {
      const problem = await destinationProblem(ctx.organization.id, data.href);
      if (problem) return { success: false, error: problem };
    }

    /* An image reference from a browser is only trusted once it is shown to
     * live in this org's own Cloudinary folder. */
    if (data.image && !isOrgAsset(data.image, ctx.organization.id)) {
      return {
        success: false,
        error: 'That image wasn’t uploaded through this workspace. Remove it and upload it again.',
      };
    }

    const previous = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: ctx.organization.id },
      select: { announcementImagePublicId: true },
    });

    const updated = await prisma.campaign.updateMany({
      where: { id: campaignId, organizationId: ctx.organization.id },
      data: {
        announcementStyle: data.style,
        announcementText: data.text?.trim() || null,
        announcementDetail: data.detail?.trim() || null,
        announcementCta: data.cta?.trim() || null,
        announcementHref: data.href?.trim() || null,
        announcementImageUrl: data.image?.url ?? null,
        announcementImagePublicId: data.image?.publicId ?? null,
        announcementBg: data.background?.trim() || null,
        announcementFg: data.foreground?.trim() || null,
        announcementScroll: Boolean(data.scroll),
      },
    });
    if (updated.count === 0) return { success: false, error: 'Campaign not found' };

    /* Replaced or removed: drop the old file. Best-effort — a leftover asset
     * is cheaper than a failed save. */
    const wasPublicId = previous?.announcementImagePublicId ?? null;
    if (wasPublicId && wasPublicId !== (data.image?.publicId ?? null)) {
      await destroyAsset(wasPublicId);
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'marketing.campaign.announcement_updated',
      entityType: 'Campaign',
      entityId: campaignId,
      metadata: { style: data.style },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save that announcement');
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * A page for the sale
 *
 * A campaign prices products; it does not make a page. So "see everything in
 * the anniversary sale" had nowhere to point, and a merchant typing
 * "/anniversary-deals" got a 404 they found out about from a customer.
 *
 * This makes a real collection holding exactly what the campaign priced, so
 * the storefront serves /collections/{slug} like any other. It is an ordinary
 * collection afterwards — the merchant can rename it, add a picture, reorder
 * it, or delete it. Nothing about it is special except that we filled it in.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The PRODUCTS a campaign covers.
 *
 * CampaignPrice rows name the thing with a price — a variant, usually — but a
 * collection holds products. Two sizes of the same skirt are one entry.
 */
async function campaignProductIds(campaignId: string, organizationId: string): Promise<string[]> {
  const priced = await prisma.campaignPrice.findMany({
    where: { campaignId, organizationId },
    select: { inventoryItem: { select: { id: true, parentItemId: true } } },
  });
  return [...new Set(priced.map((p) => p.inventoryItem.parentItemId ?? p.inventoryItem.id))];
}

export interface CampaignCollectionResult {
  slug: string;
  name: string;
  productCount: number;
  /** false when it already existed and was refreshed */
  created: boolean;
}

export async function createCampaignCollection(
  campaignId: string,
): Promise<ActionResult<CampaignCollectionResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE);
    const organizationId = ctx.organization.id;

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, name: true, collectionId: true },
    });
    if (!campaign) return { success: false, error: 'Campaign not found' };

    const productIds = await campaignProductIds(campaignId, organizationId);
    if (productIds.length === 0) {
      return {
        success: false,
        error: 'Schedule the campaign first — until then there are no products to put in a collection.',
      };
    }

    /* Already made one: refresh what's in it rather than leaving a second
     * half-right collection behind. */
    if (campaign.collectionId) {
      const existing = await prisma.collection.findFirst({
        where: { id: campaign.collectionId, organizationId },
        select: { id: true, name: true, slug: true },
      });
      if (existing) {
        await prisma.$transaction(async (tx) => {
          await tx.collectionItem.deleteMany({ where: { collectionId: existing.id } });
          await tx.collectionItem.createMany({
            data: productIds.map((inventoryItemId, position) => ({
              collectionId: existing.id,
              inventoryItemId,
              position,
            })),
          });
        });

        await createAuditLog({
          organizationId,
          userId: ctx.userId,
          action: 'marketing.campaign.collection_synced',
          entityType: 'Campaign',
          entityId: campaignId,
          metadata: { collection: existing.name, products: productIds.length },
        });

        return {
          success: true,
          data: { slug: existing.slug, name: existing.name, productCount: productIds.length, created: false },
        };
      }
    }

    /* Name and web address must be unique in the store. The campaign's own
     * name is what a merchant will look for, with a number appended only if
     * they already have something called that. */
    const taken = await prisma.collection.findMany({
      where: { organizationId },
      select: { name: true, slug: true },
    });
    const takenNames = new Set(taken.map((c) => c.name.toLowerCase()));
    let name = campaign.name;
    for (let n = 2; takenNames.has(name.toLowerCase()); n += 1) name = `${campaign.name} ${n}`;
    const slug = uniqueSlug(slugify(name), taken.map((c) => c.slug));

    const collection = await prisma.$transaction(async (tx) => {
      const created = await tx.collection.create({
        data: {
          organizationId,
          name,
          slug,
          kind: 'CURATED',
          /* Visible, because the whole point is a page to send people to.
           * Not featured — where it sits in the navigation is the
           * merchant's decision, not a side effect of making it. */
          isVisible: true,
          tagline: null,
        },
        select: { id: true, name: true, slug: true },
      });

      await tx.collectionItem.createMany({
        data: productIds.map((inventoryItemId, position) => ({
          collectionId: created.id,
          inventoryItemId,
          position,
        })),
      });

      await tx.campaign.update({ where: { id: campaignId }, data: { collectionId: created.id } });
      return created;
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'marketing.campaign.collection_created',
      entityType: 'Campaign',
      entityId: campaignId,
      metadata: { collection: collection.name, slug: collection.slug, products: productIds.length },
    });

    return {
      success: true,
      data: { slug: collection.slug, name: collection.name, productCount: productIds.length, created: true },
    };
  } catch (error) {
    return failure(error, 'We couldn’t make that collection');
  }
}

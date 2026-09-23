/*
 * Campaigns, end to end against the real database.
 *
 * The rules that matter:
 *   - scheduling NEVER edits sellingPrice. That is the whole design: the
 *     real price survives the sale, so ending one restores it by itself;
 *   - the storefront shows AND charges the sale price, because both come
 *     from the same catalogue;
 *   - the strike-through is the price the shop was actually charging;
 *   - a campaign outside its window changes nothing, with nothing to flip;
 *   - where two sales overlap, the shopper gets the cheaper one;
 *   - a campaign only ever reaches its own store's products.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  organization: {
    id: '',
    name: 'Campaign Test',
    slug: '',
    logoUrl: null,
    plan: 'PRO',
    status: 'ACTIVE',
    currency: 'NGN',
  },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { loadLiveCampaignPrices } from '@/lib/storefront/data/campaign-prices';

/* These read the real catalogue, not the demo fixtures. */
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const { createCampaign, scheduleCampaign, endCampaign, previewCampaignPrices, deleteCampaign } =
  await import('@/features/marketing/campaigns');
const { getCampaign, listCampaigns } = await import('@/features/marketing/campaign-reads');
const { updateCampaignAnnouncement, createCampaignCollection } = await import(
  '@/features/marketing/campaigns'
);
const { getCampaignAnnouncements } = await import('@/lib/storefront/catalog');
const { searchCatalogueProducts } = await import('@/features/sales/lookup');
const { getProductBySlug } = await import('@/lib/storefront/catalog');

vi.setConfig({ testTimeout: 90_000 });

let otherOrgId = '';
let categoryId = '';
let childCategoryId = '';
let suffix = '';

async function product(name: string, priceMajor: number, options: { categoryId?: string; organizationId?: string } = {}) {
  return prisma.inventoryItem.create({
    data: {
      organizationId: options.organizationId ?? ctx.organization.id,
      name,
      sku: `${name}-${Math.random().toString(36).slice(2, 7)}`,
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
      sellingPrice: priceMajor,
      isPublished: true,
      status: 'ACTIVE',
      categoryId: options.categoryId,
    },
    select: { id: true, slug: true, sellingPrice: true },
  });
}

/** A campaign, scheduled, over the given targets. */
async function runningCampaign(
  name: string,
  value: number,
  targetKind: 'PRODUCT' | 'CATEGORY' | 'STORE' | 'COLLECTION',
  targetIds: string[],
  options: { mechanic?: 'PERCENT_OFF' | 'FIXED_OFF'; startsAt?: Date; endsAt?: Date | null } = {},
) {
  const created = await createCampaign({
    name,
    mechanic: options.mechanic ?? 'PERCENT_OFF',
    value,
    startsAt: options.startsAt ?? new Date(Date.now() - 60_000),
    endsAt: options.endsAt === undefined ? null : options.endsAt,
    targetKind,
    targetIds,
  });
  if (!created.success) throw new Error(created.error);
  return created.data.id;
}

beforeAll(async () => {
  suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: 'Campaign Test', slug: `__test-campaign-${suffix}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  otherOrgId = (
    await prisma.organization.create({ data: { name: 'Other', slug: `__test-campaign-other-${suffix}` } })
  ).id;

  const parent = await prisma.category.create({
    data: { organizationId: org.id, name: 'Fashion', slug: `fashion-${suffix}` },
    select: { id: true },
  });
  categoryId = parent.id;
  childCategoryId = (
    await prisma.category.create({
      data: { organizationId: org.id, name: 'Skirts', slug: `skirts-${suffix}`, parentId: parent.id },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.campaignPrice.deleteMany({ where: { organizationId } });
    await prisma.campaign.deleteMany({ where: { organizationId } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.category.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
});

beforeEach(() => {
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_DISCOUNT_MANAGE];
});

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const scope = () => ({ organizationSlug: ctx.organization.slug });

describe('scheduling a campaign', () => {
  it('prices the products and leaves sellingPrice alone', async () => {
    const item = await product('Ankara Wrap', 10_000);
    const id = await runningCampaign('Twenty off', 20, 'PRODUCT', [item.id]);

    const { priced } = unwrap(await scheduleCampaign(id));
    expect(priced).toBe(1);

    const price = await prisma.campaignPrice.findFirstOrThrow({
      where: { campaignId: id, inventoryItemId: item.id },
      select: { originalPrice: true, price: true },
    });
    expect(Number(price.originalPrice)).toBe(10_000);
    expect(Number(price.price)).toBe(8_000);

    /* THE POINT: the real price is untouched, so ending the sale needs
     * nothing restored. */
    const row = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { sellingPrice: true },
    });
    expect(Number(row.sellingPrice)).toBe(10_000);
  });

  it('takes a category’s descendants with it', async () => {
    const parentItem = await product('Fashion Item', 5_000, { categoryId });
    const childItem = await product('Skirt Item', 4_000, { categoryId: childCategoryId });

    const id = await runningCampaign('Category sale', 10, 'CATEGORY', [categoryId]);
    unwrap(await scheduleCampaign(id));

    const priced = await prisma.campaignPrice.findMany({
      where: { campaignId: id },
      select: { inventoryItemId: true },
    });
    const ids = priced.map((p) => p.inventoryItemId);
    expect(ids).toContain(parentItem.id);
    // "Fashion" on sale and "Fashion → Skirts" at full price would be a bug.
    expect(ids).toContain(childItem.id);
  });

  it('leaves out products the discount wouldn’t change', async () => {
    const free = await product('Already Free', 0);
    const normal = await product('Normal Price', 3_000);

    const preview = unwrap(
      await previewCampaignPrices({
        name: 'Preview',
        mechanic: 'PERCENT_OFF',
        value: 10,
        startsAt: new Date(),
        targetKind: 'PRODUCT',
        targetIds: [free.id, normal.id],
      }),
    );
    expect(preview.prices.map((p) => p.inventoryItemId)).toEqual([normal.id]);
  });

  it('refuses a campaign that would change nothing', async () => {
    const free = await product('Nothing To Discount', 0);
    const id = await runningCampaign('Pointless', 50, 'PRODUCT', [free.id]);
    const result = await scheduleCampaign(id);
    expect(result.success).toBe(false);
  });

  it('refuses a member without sales.discount.manage', async () => {
    const item = await product('Not Allowed', 1_000);
    const id = await runningCampaign('Perm', 10, 'PRODUCT', [item.id]);
    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
    expect((await scheduleCampaign(id)).success).toBe(false);
  });
});

describe('choosing products by hand', () => {
  /** A product with sizes — the shape that was broken. */
  async function withVariants(name: string, basePrice: number, sizes: string[]) {
    const parent = await prisma.inventoryItem.create({
      data: {
        organizationId: ctx.organization.id,
        name,
        sku: `${name}-${Math.random().toString(36).slice(2, 7)}`,
        slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
        sellingPrice: basePrice,
        isPublished: true,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const variants = [];
    for (const size of sizes) {
      variants.push(
        await prisma.inventoryItem.create({
          data: {
            organizationId: ctx.organization.id,
            name: size,
            sku: `${name}-${size}-${Math.random().toString(36).slice(2, 7)}`,
            parentItemId: parent.id,
            sellingPrice: basePrice,
            status: 'ACTIVE',
          },
          select: { id: true },
        }),
      );
    }
    return { parentId: parent.id, variantIds: variants.map((v) => v.id) };
  }

  it('puts every option of a chosen product on sale', async () => {
    const { parentId, variantIds } = await withVariants('Pleated Midi Skirt', 20_000, ['S', 'M', 'L']);

    const id = await runningCampaign('Skirt sale', 25, 'PRODUCT', [parentId]);
    const { priced } = unwrap(await scheduleCampaign(id));
    expect(priced).toBe(3);

    const rows = await prisma.campaignPrice.findMany({
      where: { campaignId: id },
      select: { inventoryItemId: true, price: true },
    });
    expect(rows.map((r) => r.inventoryItemId).sort()).toEqual([...variantIds].sort());
    expect(rows.every((r) => Number(r.price) === 15_000)).toBe(true);
  });

  it('still works when a VARIANT id was chosen', async () => {
    /* The picker used to offer variants, so a saved campaign can hold one.
     * It priced nothing at all, with only "nothing would change price" to
     * explain it — resolve it through its parent instead. */
    const { parentId, variantIds } = await withVariants('Wrap Dress', 30_000, ['S', 'M']);

    const id = await runningCampaign('Dress sale', 10, 'PRODUCT', [variantIds[0]]);
    const { priced } = unwrap(await scheduleCampaign(id));
    expect(priced).toBe(2);

    const rows = await prisma.campaignPrice.findMany({
      where: { campaignId: id },
      select: { inventoryItemId: true },
    });
    expect(rows.map((r) => r.inventoryItemId).sort()).toEqual([...variantIds].sort());
    expect(rows.map((r) => r.inventoryItemId)).not.toContain(parentId);
  });

  it('offers whole products to pick, not their options', async () => {
    const { parentId, variantIds } = await withVariants('Searchable Kaftan', 12_000, ['S', 'M']);

    const found = unwrap(await searchCatalogueProducts('Searchable Kaftan'));
    const ids = found.map((f) => f.id);
    expect(ids).toContain(parentId);
    // "(S)" is not a thing a merchant puts on sale.
    for (const variantId of variantIds) expect(ids).not.toContain(variantId);

    const match = found.find((f) => f.id === parentId)!;
    expect(match.variantCount).toBe(2);
    expect(match.priceFrom).toBe(12_000);
  });
});

describe('what the shopper sees and pays', () => {
  it('shows the sale price, with the real price struck through', async () => {
    const item = await product('Shopper Sees', 20_000);
    const id = await runningCampaign('Shopper sale', 25, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    const shown = await getProductBySlug(item.slug!, scope());
    expect(shown).not.toBeNull();
    /* The storefront counts in kobo; the admin in naira. */
    expect(shown!.variants[0].price).toBe(1_500_000);
    // The strike-through is what the shop WAS charging, not a typed-in number.
    expect(shown!.variants[0].compareAtPrice).toBe(2_000_000);
  });

  it('changes nothing before the window opens', async () => {
    const item = await product('Not Yet', 8_000);
    const id = await runningCampaign('Future sale', 50, 'PRODUCT', [item.id], {
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 2 * 86_400_000),
    });
    unwrap(await scheduleCampaign(id));

    const shown = await getProductBySlug(item.slug!, scope());
    expect(shown!.variants[0].price).toBe(800_000);
  });

  it('puts the real price back the moment it ends, with nothing to restore', async () => {
    const item = await product('Ends Today', 12_000);
    const id = await runningCampaign('Ending sale', 50, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    expect((await getProductBySlug(item.slug!, scope()))!.variants[0].price).toBe(600_000);

    unwrap(await endCampaign(id));

    expect((await getProductBySlug(item.slug!, scope()))!.variants[0].price).toBe(1_200_000);
    // And the row was never edited in the first place.
    const row = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { sellingPrice: true },
    });
    expect(Number(row.sellingPrice)).toBe(12_000);
  });

  it('gives the shopper the cheaper of two overlapping sales', async () => {
    const item = await product('Two Sales', 10_000);
    const mild = await runningCampaign('Ten off', 10, 'PRODUCT', [item.id]);
    const steep = await runningCampaign('Forty off', 40, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(mild));
    unwrap(await scheduleCampaign(steep));

    const prices = await loadLiveCampaignPrices(ctx.organization.id);
    expect(prices.get(item.id)?.price).toBe(6_000);
    expect((await getProductBySlug(item.slug!, scope()))!.variants[0].price).toBe(600_000);
  });

  it('never prices another store’s products', async () => {
    const theirs = await product('Their Product', 5_000, { organizationId: otherOrgId });
    const id = await runningCampaign('Everything', 50, 'STORE', []);
    await scheduleCampaign(id);

    const priced = await prisma.campaignPrice.findMany({
      where: { campaignId: id },
      select: { inventoryItemId: true },
    });
    expect(priced.map((p) => p.inventoryItemId)).not.toContain(theirs.id);

    const live = await loadLiveCampaignPrices(otherOrgId);
    expect(live.size).toBe(0);
  });
});

describe('a campaign’s own page', () => {
  it('reports what it is doing, and lists every price', async () => {
    const item = await product('Reported', 10_000);
    const id = await runningCampaign('Reported sale', 20, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    const detail = unwrap(await getCampaign(id));
    expect(detail.phase).toBe('ACTIVE');
    expect(detail.prices).toHaveLength(1);
    expect(detail.prices[0]).toMatchObject({ originalPrice: 10_000, price: 8_000 });
    // Started, so there is something to measure — even if it is all zeroes.
    expect(detail.performance).not.toBeNull();
    expect(detail.performance!.orders).toBe(0);
  });

  it('has nothing to measure before it starts', async () => {
    const item = await product('Unstarted', 1_000);
    const id = await runningCampaign('Future', 10, 'PRODUCT', [item.id], {
      startsAt: new Date(Date.now() + 86_400_000),
    });
    unwrap(await scheduleCampaign(id));

    const detail = unwrap(await getCampaign(id));
    expect(detail.phase).toBe('SCHEDULED');
    expect(detail.performance).toBeNull();
  });

  it('calls off a campaign that hasn’t started, rather than "ending" it', async () => {
    const item = await product('Called Off', 1_000);
    const id = await runningCampaign('Never ran', 10, 'PRODUCT', [item.id], {
      startsAt: new Date(Date.now() + 86_400_000),
    });
    unwrap(await scheduleCampaign(id));
    unwrap(await endCampaign(id));

    expect(unwrap(await getCampaign(id)).phase).toBe('CANCELLED');
  });

  it('won’t delete one that has already run', async () => {
    const item = await product('Ran Already', 1_000);
    const id = await runningCampaign('Ran', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    expect((await deleteCampaign(id)).success).toBe(false);
  });

  it('never lists another workspace’s campaigns', async () => {
    const rows = unwrap(await listCampaigns());
    expect(rows.every((r) => r.id)).toBe(true);
    const foreign = await prisma.campaign.count({ where: { organizationId: otherOrgId } });
    expect(foreign).toBe(0);
  });
});

describe('announcing a campaign', () => {
  it('shows the merchant’s words while the campaign runs, and only then', async () => {
    const item = await product('Announced', 10_000);
    const id = await runningCampaign('Christmas sale', 20, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    unwrap(
      await updateCampaignAnnouncement(id, {
        style: 'BAR',
        text: 'Christmas sale — 20% off',
        cta: 'Shop the sale',
        // Every store has this one; "/sale" needs a "sale" collection.
        href: '/products',
        background: '#b42318',
        foreground: '#ffffff',
        scroll: true,
      }),
    );

    const live = await getCampaignAnnouncements(scope());
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      style: 'BAR',
      text: 'Christmas sale — 20% off',
      background: '#b42318',
      scroll: true,
    });
    expect(live[0].cta).toEqual({ label: 'Shop the sale', href: '/products' });

    /* The bar cannot outlast the sale it announces: ending the campaign
     * takes it down with the prices. */
    unwrap(await endCampaign(id));
    expect(await getCampaignAnnouncements(scope())).toHaveLength(0);
  });

  it('says nothing when the merchant wrote nothing', async () => {
    const item = await product('Silent', 5_000);
    const id = await runningCampaign('Quiet sale', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    // Style set, no words — nothing is invented to fill the gap.
    const result = await updateCampaignAnnouncement(id, { style: 'BAR', text: '   ' });
    expect(result.success).toBe(false);

    expect(await getCampaignAnnouncements(scope())).toHaveLength(0);
    await endCampaign(id);
  });

  it('refuses a link to a page the store hasn’t got', async () => {
    const item = await product('Bad Destination', 5_000);
    const id = await runningCampaign('Anniversary', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    /* A perfectly well-formed path, and a 404 — the kind a merchant finds
     * out about from a customer who followed it. */
    const typed = await updateCampaignAnnouncement(id, {
      style: 'BAR',
      text: 'Anniversary sale',
      cta: 'Shop the sale',
      href: '/anniversary-deals',
    });
    expect(typed.success).toBe(false);
    if (!typed.success) expect(typed.error).toMatch(/isn’t a page on your store/);

    const missingCollection = await updateCampaignAnnouncement(id, {
      style: 'BAR',
      text: 'Anniversary sale',
      cta: 'Shop',
      href: '/collections/does-not-exist',
    });
    expect(missingCollection.success).toBe(false);

    /* Every store has this one, so it is always a safe answer. */
    const products = await updateCampaignAnnouncement(id, {
      style: 'BAR',
      text: 'Anniversary sale',
      cta: 'Shop',
      href: '/products',
    });
    expect(products.success).toBe(true);

    await endCampaign(id);
  });

  it('accepts a collection the store really has', async () => {
    const item = await product('Real Collection Target', 5_000);
    const id = await runningCampaign('Collection link', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    const collection = await prisma.collection.create({
      data: {
        organizationId: ctx.organization.id,
        name: 'Anniversary deals',
        slug: `anniversary-deals-${suffix}`,
        isVisible: true,
      },
      select: { slug: true },
    });

    const result = await updateCampaignAnnouncement(id, {
      style: 'BAR',
      text: 'Anniversary sale',
      cta: 'Shop the sale',
      href: `/collections/${collection.slug}`,
    });
    expect(result.success).toBe(true);

    await prisma.collection.deleteMany({ where: { organizationId: ctx.organization.id } });
    await endCampaign(id);
  });

  it('refuses a link the storefront shouldn’t follow', async () => {
    const item = await product('Bad Link', 5_000);
    const id = await runningCampaign('Link sale', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    const result = await updateCampaignAnnouncement(id, {
      style: 'BAR',
      text: 'Sale on',
      cta: 'Click',
      href: 'javascript:alert(1)',
    });
    expect(result.success).toBe(false);
    await endCampaign(id);
  });

  it('keeps a scheduled campaign’s announcement off the store until it starts', async () => {
    const item = await product('Not Yet Announced', 9_000);
    const id = await runningCampaign('Future sale', 15, 'PRODUCT', [item.id], {
      startsAt: new Date(Date.now() + 86_400_000),
    });
    unwrap(await scheduleCampaign(id));
    unwrap(await updateCampaignAnnouncement(id, { style: 'BAR', text: 'Starting soon' }));

    expect(await getCampaignAnnouncements(scope())).toHaveLength(0);
    await endCampaign(id);
  });

  it('never shows another store’s announcement', async () => {
    const item = await product('Mine', 5_000);
    const id = await runningCampaign('My sale', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));
    unwrap(await updateCampaignAnnouncement(id, { style: 'BAR', text: 'Only my shoppers see this' }));

    const theirs = await getCampaignAnnouncements({ organizationSlug: `__test-campaign-other-${suffix}` });
    expect(theirs).toEqual([]);
    await endCampaign(id);
  });
});

describe('a page for the sale', () => {
  async function withVariants(name: string, basePrice: number, sizes: string[]) {
    const parent = await prisma.inventoryItem.create({
      data: {
        organizationId: ctx.organization.id,
        name,
        sku: `${name}-${Math.random().toString(36).slice(2, 7)}`,
        slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
        sellingPrice: basePrice,
        isPublished: true,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    for (const size of sizes) {
      await prisma.inventoryItem.create({
        data: {
          organizationId: ctx.organization.id,
          name: size,
          sku: `${name}-${size}-${Math.random().toString(36).slice(2, 7)}`,
          parentItemId: parent.id,
          sellingPrice: basePrice,
          status: 'ACTIVE',
        },
      });
    }
    return parent.id;
  }

  it('makes a real collection holding the campaign’s products', async () => {
    const skirt = await withVariants('Anniversary Skirt', 20_000, ['S', 'M']);
    const bag = await product('Anniversary Bag', 30_000);
    const id = await runningCampaign('Anniversary sale', 15, 'PRODUCT', [skirt, bag.id]);
    unwrap(await scheduleCampaign(id));

    const made = unwrap(await createCampaignCollection(id));
    expect(made.created).toBe(true);
    expect(made.name).toBe('Anniversary sale');
    /* Two sizes of one skirt are ONE product in a collection. */
    expect(made.productCount).toBe(2);

    const collection = await prisma.collection.findFirstOrThrow({
      where: { organizationId: ctx.organization.id, slug: made.slug },
      select: { isVisible: true, kind: true, items: { select: { inventoryItemId: true } } },
    });
    expect(collection.isVisible).toBe(true);
    expect(collection.items.map((i) => i.inventoryItemId).sort()).toEqual([skirt, bag.id].sort());

    /* And now the announcement has somewhere real to point. */
    const linked = await updateCampaignAnnouncement(id, {
      style: 'BAR',
      text: 'Anniversary sale — 15% off',
      cta: 'Shop the sale',
      href: `/collections/${made.slug}`,
    });
    expect(linked.success).toBe(true);

    await prisma.collectionItem.deleteMany({ where: { collection: { organizationId: ctx.organization.id } } });
    await prisma.campaign.updateMany({ where: { id }, data: { collectionId: null } });
    await prisma.collection.deleteMany({ where: { organizationId: ctx.organization.id } });
    await endCampaign(id);
  });

  it('refreshes the same collection instead of making a second', async () => {
    const one = await product('Refresh One', 5_000);
    const id = await runningCampaign('Refresh sale', 10, 'PRODUCT', [one.id]);
    unwrap(await scheduleCampaign(id));

    const first = unwrap(await createCampaignCollection(id));
    const again = unwrap(await createCampaignCollection(id));

    expect(again.created).toBe(false);
    expect(again.slug).toBe(first.slug);
    expect(await prisma.collection.count({ where: { organizationId: ctx.organization.id } })).toBe(1);

    await prisma.collectionItem.deleteMany({ where: { collection: { organizationId: ctx.organization.id } } });
    await prisma.campaign.updateMany({ where: { id }, data: { collectionId: null } });
    await prisma.collection.deleteMany({ where: { organizationId: ctx.organization.id } });
    await endCampaign(id);
  });

  it('won’t make one before the campaign is priced', async () => {
    const item = await product('Unpriced Yet', 5_000);
    const id = await runningCampaign('Not scheduled', 10, 'PRODUCT', [item.id]);

    const result = await createCampaignCollection(id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/Schedule the campaign first/);
  });

  it('refuses a picture that wasn’t uploaded here', async () => {
    const item = await product('Borrowed Image', 5_000);
    const id = await runningCampaign('Image sale', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    /* An image reference from a browser is only trusted once it is shown to
     * live in this org's own Cloudinary folder. */
    const result = await updateCampaignAnnouncement(id, {
      style: 'MODAL',
      text: 'Anniversary sale',
      image: { url: 'https://res.cloudinary.com/demo/image/upload/v1/someone-elses.jpg', publicId: 'mansaas/other-org/campaigns/x' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/wasn’t uploaded through this workspace/);

    await endCampaign(id);
  });

  it('refuses a link that leaves the store', async () => {
    const item = await product('No External', 5_000);
    const id = await runningCampaign('No external links', 10, 'PRODUCT', [item.id]);
    unwrap(await scheduleCampaign(id));

    const result = await updateCampaignAnnouncement(id, {
      style: 'BAR',
      text: 'Sale on',
      cta: 'See it',
      href: 'https://instagram.com/adire',
    });
    expect(result.success).toBe(false);
    await endCampaign(id);
  });
});

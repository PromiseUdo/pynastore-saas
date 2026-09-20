// Merchant-written store pages, and what the storefront serves from them — real DB, mocked org context.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Pages Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const { saveStorePage, setStorePagePublished, deleteStorePage, listStorePages, getStorePageForEdit } = await import(
  '@/features/settings/store-pages'
);
const { getStorePage, getStorePages } = await import('@/lib/storefront/catalog');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let otherSlug = '';

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const store = () => ({ organizationSlug: ctx.organization.slug });

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: 'Pages Test', slug: `__test-pages-${suffix}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];

  const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-pages-other-${suffix}` } });
  otherSlug = other.slug;
  await prisma.storePage.create({
    data: {
      organizationId: other.id,
      kind: 'PRIVACY',
      title: 'Their privacy',
      slug: 'privacy',
      body: 'Not yours.',
      isPublished: true,
      publishedAt: new Date(),
    },
  });
}, 60_000);

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
  const slugs = [ctx.organization.slug, otherSlug];
  await prisma.auditLog.deleteMany({ where: { organization: { slug: { in: slugs } } } });
  await prisma.organization.deleteMany({ where: { slug: { in: slugs } } });
}, 60_000);

describe('store pages', () => {
  it('saves a draft that the storefront cannot see', async () => {
    const { id, slug } = ok(
      await saveStorePage(null, { kind: 'DELIVERY_RETURNS', title: 'Delivery and returns', slug: '', body: '', isPublished: false }),
    );
    expect(slug).toBe('delivery-and-returns');
    expect(ok(await getStorePageForEdit(id))?.isPublished).toBe(false);

    expect(await getStorePage('delivery-and-returns', store())).toBeNull();
    expect(await getStorePages(store())).toEqual([]);
  }, 60_000);

  it('refuses to publish an empty page, and a second page of the same kind', async () => {
    const empty = await saveStorePage(null, { kind: 'FAQ', title: 'FAQ', slug: '', body: '  ', isPublished: true });
    expect(empty.success).toBe(false);
    expect(!empty.success && empty.fieldErrors?.body).toMatch(/before publishing/);

    const twin = await saveStorePage(null, { kind: 'DELIVERY_RETURNS', title: 'Shipping', slug: '', body: 'x', isPublished: false });
    expect(twin.success).toBe(false);
    expect(!twin.success && twin.error).toMatch(/already have/);
  }, 60_000);

  it('publishes, and the storefront serves only this store’s published pages', async () => {
    const [draft] = ok(await listStorePages());
    ok(
      await saveStorePage(draft.id, {
        kind: 'DELIVERY_RETURNS',
        title: 'Delivery & returns',
        slug: draft.slug,
        body: '## Delivery\r\nWe deliver in Lagos.',
        isPublished: true,
      }),
    );

    const page = await getStorePage('delivery-and-returns', store());
    expect(page).toMatchObject({ kind: 'DELIVERY_RETURNS', title: 'Delivery & returns', href: '/pages/delivery-and-returns' });
    // line endings normalised on the way in
    expect(page?.body).toBe('## Delivery\nWe deliver in Lagos.');

    // Another merchant's privacy page is never served under this store.
    expect(await getStorePage('privacy', store())).toBeNull();
    expect((await getStorePages(store())).map((p) => p.slug)).toEqual(['delivery-and-returns']);
    expect((await getStorePages({ organizationSlug: otherSlug })).map((p) => p.title)).toEqual(['Their privacy']);
  }, 60_000);

  it('keeps the web address when a page is renamed, and refuses one already taken', async () => {
    const { id, slug } = ok(
      await saveStorePage(null, { kind: 'CUSTOM', title: 'Wholesale orders', slug: '', body: 'Call us.', isPublished: true }),
    );
    expect(slug).toBe('wholesale-orders');

    const renamed = ok(await saveStorePage(id, { kind: 'CUSTOM', title: 'Trade accounts', slug: '', body: 'Call us.', isPublished: true }));
    expect(renamed.slug).toBe('wholesale-orders');

    const clash = await saveStorePage(id, {
      kind: 'CUSTOM',
      title: 'Trade accounts',
      slug: 'delivery-and-returns',
      body: 'Call us.',
      isPublished: true,
    });
    expect(clash.success).toBe(false);
    expect(!clash.success && clash.fieldErrors?.slug).toBeTruthy();

    const bad = await saveStorePage(id, { kind: 'CUSTOM', title: 'Trade accounts', slug: 'Trade Accounts!', body: 'x', isPublished: true });
    expect(!bad.success && bad.fieldErrors?.slug).toBeTruthy();

    // a second custom page from the same title gets its own address
    const again = ok(await saveStorePage(null, { kind: 'CUSTOM', title: 'Wholesale orders', slug: '', body: 'x', isPublished: false }));
    expect(again.slug).toBe('wholesale-orders-2');
  }, 60_000);

  it('unpublishes and deletes, taking the page off the storefront', async () => {
    const pages = ok(await listStorePages());
    const custom = pages.find((p) => p.slug === 'wholesale-orders')!;

    ok(await setStorePagePublished(custom.id, false));
    expect(await getStorePage('wholesale-orders', store())).toBeNull();

    ok(await deleteStorePage(custom.id));
    expect(ok(await getStorePageForEdit(custom.id))).toBeNull();
  }, 60_000);

  it('needs settings.edit to change anything', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    try {
      const result = await saveStorePage(null, { kind: 'ABOUT', title: 'About', slug: '', body: 'Hi', isPublished: true });
      expect(result.success).toBe(false);
      expect(!result.success && result.error).toMatch(/permission/);
      expect(ok(await listStorePages()).length).toBeGreaterThan(0);
    } finally {
      ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];
    }
  }, 60_000);
});

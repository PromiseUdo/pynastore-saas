// Category server actions against the real DB, with the org context mocked
// (the real one reads the tenant from request headers). A throwaway org is
// created per run and removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Category Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { createCategory, updateCategory, moveCategory, deleteCategory, listCategories } = await import(
  '@/features/inventory/categories'
);

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Category Test', slug: `__test-categories-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CATEGORY_MANAGE];
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  // children before parents
  for (let i = 0; i < 4; i++) {
    const leaves = await prisma.category.findMany({ where: { organizationId, children: { none: {} } } });
    await prisma.category.deleteMany({ where: { id: { in: leaves.map((l) => l.id) } } });
  }
  await prisma.organization.delete({ where: { id: organizationId } });
});

async function create(name: string, parentId: string | null = null, extra: Record<string, unknown> = {}) {
  const result = await createCategory({ name, parentId, ...extra });
  if (!result.success) throw new Error(result.error);
  return result.data.id;
}

describe('category actions', () => {
  it('builds a 3-level tree with generated slugs and refuses a 4th level', async () => {
    const fashion = await create('Fashion & Clothing', null, { isFeatured: true });
    const women = await create("Women's", fashion);
    const skirts = await create('Skirts', women, { isFeatured: true });

    const rows = (await listCategories()) as { success: true; data: { id: string; slug: string; isFeatured: boolean }[] };
    const byId = new Map(rows.data.map((r) => [r.id, r]));
    expect(byId.get(fashion)).toMatchObject({ slug: 'fashion-and-clothing', isFeatured: true });
    expect(byId.get(women)?.slug).toBe('womens');
    // featured is a top-level-only flag
    expect(byId.get(skirts)?.isFeatured).toBe(false);

    const tooDeep = await createCategory({ name: 'Mini', parentId: skirts });
    expect(tooDeep).toEqual({ success: false, error: expect.stringMatching(/3 levels/) });
  });

  it('rejects case-insensitive duplicate names among top-level siblings', async () => {
    await create('Electronics');
    const dup = await createCategory({ name: 'ELECTRONICS', parentId: null });
    expect(dup.success).toBe(false);
  });

  it('allows the same name under different parents', async () => {
    const a = await create('Kids A');
    const b = await create('Kids B');
    await create('Shoes', a);
    await expect(create('Shoes', b)).resolves.toBeTruthy();
  });

  it('keeps the slug on rename, and blocks moving a category under its own subcategory', async () => {
    const home = await create('Home');
    const kitchen = await create('Kitchen', home);

    const renamed = await updateCategory(home, { name: 'Home & Living', parentId: null, slug: '' });
    expect(renamed.success).toBe(true);
    const row = await prisma.category.findUniqueOrThrow({ where: { id: home } });
    expect(row.slug).toBe('home');

    const cycle = await updateCategory(home, { name: 'Home & Living', parentId: kitchen });
    expect(cycle).toEqual({ success: false, error: expect.stringMatching(/own subcategories/) });
  });

  it('saves "goes well with" pairings from this store only, and a visibility toggle keeps them', async () => {
    const dresses = await create('Dresses');
    const bags = await create('Bags');
    const jewellery = await create('Jewellery');
    // A real category id that belongs to someone else.
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other', slug: `__test-categories-other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });
    const foreign = await prisma.category.create({
      data: { organizationId: otherOrg.id, name: 'Foreign', slug: 'foreign' },
    });

    try {
      const saved = await updateCategory(dresses, {
        name: 'Dresses',
        parentId: null,
        companionIds: [jewellery, dresses, foreign.id, bags],
        companionTitle: 'Complete the look',
      });
      expect(saved).toEqual({ success: true, data: undefined });
      let row = await prisma.category.findUniqueOrThrow({ where: { id: dresses } });
      expect(row.companionIds).toEqual([jewellery, bags]);
      expect(row.companionTitle).toBe('Complete the look');

      // The row's quick hide/show sends no pairings — they must survive it.
      expect((await updateCategory(dresses, { name: 'Dresses', parentId: null, isVisible: false })).success).toBe(true);
      row = await prisma.category.findUniqueOrThrow({ where: { id: dresses } });
      expect(row.companionIds).toEqual([jewellery, bags]);
      expect(row.isVisible).toBe(false);
    } finally {
      await prisma.category.delete({ where: { id: foreign.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });

  it('reorders siblings', async () => {
    const parent = await create('Garden');
    const first = await create('Tools', parent);
    const second = await create('Plants', parent);

    expect((await moveCategory(second, 'up')).success).toBe(true);
    const ordered = await prisma.category.findMany({ where: { parentId: parent }, orderBy: { sortOrder: 'asc' } });
    expect(ordered.map((c) => c.id)).toEqual([second, first]);
  });

  it('only deletes empty categories', async () => {
    const parent = await create('Toys');
    const child = await create('Puzzles', parent);

    expect((await deleteCategory(parent)).success).toBe(false);
    expect((await deleteCategory(child)).success).toBe(true);
    expect((await deleteCategory(parent)).success).toBe(true);
  });

  it('refuses without the manage permission', async () => {
    const saved = ctx.membership.role.permissions;
    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW];
    try {
      const result = await createCategory({ name: 'Nope', parentId: null });
      expect(result).toEqual({ success: false, error: 'You do not have permission to do this' });
    } finally {
      ctx.membership.role.permissions = saved;
    }
  });
});

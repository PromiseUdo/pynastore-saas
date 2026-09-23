/*
 * The merchant's own storefront — hero slides, colour, and how the shop is
 * listed — against the real database.
 *
 * The rules that matter:
 *   - a shop that has filled in nothing gets the storefront's defaults, not
 *     a headline or a colour chosen on its behalf;
 *   - a hidden slide, or one with no headline, is not shown;
 *   - a button needs both a label and somewhere to go, or it isn't offered;
 *   - a colour only reaches the page if it is a real one;
 *   - nothing here ever reaches another workspace's storefront.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  organization: {
    id: '',
    name: 'Look Test',
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
import { loadStorefrontLook } from '@/lib/storefront/data/appearance';

const { saveHeroSlide, saveStorefrontAppearance, deleteHeroSlide, reorderHeroSlides, getStorefrontAppearance } =
  await import('@/features/settings/storefront');

vi.setConfig({ testTimeout: 90_000 });

let otherOrgId = '';
let otherSlug = '';

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: 'Look Test', slug: `__test-look-${suffix}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  otherSlug = `__test-look-other-${suffix}`;
  otherOrgId = (await prisma.organization.create({ data: { name: 'Other', slug: otherSlug } })).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.storefrontHeroSlide.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

beforeEach(async () => {
  ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];
  await prisma.storefrontHeroSlide.deleteMany({ where: { organizationId: ctx.organization.id } });
});

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const slide = (over: Record<string, unknown> = {}) => ({
  title: 'The rainy season edit',
  subtitle: 'Made for Lagos weather.',
  align: 'LEFT' as const,
  theme: 'DARK' as const,
  isVisible: true,
  ...over,
});

describe('a shop that has said nothing', () => {
  it('gets the storefront’s own defaults, not something written for it', async () => {
    const look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.hero).toEqual([]);
    expect(look.accent).toBeNull();
    expect(look.tagline).toBeNull();
    expect(look.analytics).toEqual({ gaId: null, metaPixelId: null });
  });
});

describe('hero slides', () => {
  it('shows what the merchant wrote, in the order they put it', async () => {
    const first = unwrap(await saveHeroSlide(null, slide({ title: 'First' })));
    const second = unwrap(await saveHeroSlide(null, slide({ title: 'Second' })));

    let look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.hero.map((h) => h.title)).toEqual(['First', 'Second']);

    unwrap(await reorderHeroSlides([second.id, first.id]));
    look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.hero.map((h) => h.title)).toEqual(['Second', 'First']);
  });

  it('leaves a hidden slide off the shop', async () => {
    unwrap(await saveHeroSlide(null, slide({ title: 'Shown' })));
    unwrap(await saveHeroSlide(null, slide({ title: 'Hidden', isVisible: false })));

    const look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.hero.map((h) => h.title)).toEqual(['Shown']);
  });

  it('only offers a button when it has both a label and somewhere to go', async () => {
    unwrap(await saveHeroSlide(null, slide({ ctaLabel: 'Shop it', ctaHref: '/products' })));
    let look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.hero[0].ctaHref).toBe('/products');
    expect(look.hero[0].ctaLabel).toBe('Shop it');

    await prisma.storefrontHeroSlide.deleteMany({ where: { organizationId: ctx.organization.id } });

    /* A label with nowhere to go is refused outright — the storefront would
     * otherwise render a button that does nothing. */
    const orphan = await saveHeroSlide(null, slide({ ctaLabel: 'Shop it' }));
    expect(orphan.success).toBe(false);

    unwrap(await saveHeroSlide(null, slide({ ctaHref: '/products' })));
    look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.hero[0].ctaHref).toBe('');
  });

  it('refuses a link that leaves the store', async () => {
    const result = await saveHeroSlide(null, slide({ ctaLabel: 'See it', ctaHref: 'https://example.com' }));
    expect(result.success).toBe(false);
  });

  it('removes one on request', async () => {
    const made = unwrap(await saveHeroSlide(null, slide({ title: 'Temporary' })));
    unwrap(await deleteHeroSlide(made.id));
    expect((await loadStorefrontLook(ctx.organization.slug)).hero).toEqual([]);
  });

  it('refuses a member without settings.edit', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    expect((await saveHeroSlide(null, slide())).success).toBe(false);
  });

  it('never reaches another workspace’s storefront', async () => {
    unwrap(await saveHeroSlide(null, slide({ title: 'Mine only' })));
    const theirs = await loadStorefrontLook(otherSlug);
    expect(theirs.hero).toEqual([]);
  });
});

describe('colour, listing and tracking', () => {
  it('keeps what the merchant set', async () => {
    unwrap(
      await saveStorefrontAppearance({
        accent: '#b42318',
        tagline: 'Hand-dyed adire, made in Abeokuta.',
        gaId: 'G-ABCD1234',
        metaPixelId: '1234567890123456',
      }),
    );

    const look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.accent).toBe('#b42318');
    expect(look.tagline).toBe('Hand-dyed adire, made in Abeokuta.');
    expect(look.analytics).toEqual({ gaId: 'G-ABCD1234', metaPixelId: '1234567890123456' });
  });

  it('refuses a colour that isn’t one', async () => {
    /* It reaches a `style` attribute on the storefront. */
    expect((await saveStorefrontAppearance({ accent: 'red; content: attr(x)' })).success).toBe(false);
    expect((await saveStorefrontAppearance({ accent: 'rebeccapurple' })).success).toBe(false);
  });

  it('refuses a measurement id that isn’t shaped like one', async () => {
    expect((await saveStorefrontAppearance({ gaId: 'not-an-id' })).success).toBe(false);
    expect((await saveStorefrontAppearance({ metaPixelId: 'abc' })).success).toBe(false);
  });

  it('reads back for the settings screen', async () => {
    unwrap(await saveStorefrontAppearance({ accent: '#0f5132' }));
    const data = unwrap(await getStorefrontAppearance());
    expect(data.appearance.accent).toBe('#0f5132');
  });
});

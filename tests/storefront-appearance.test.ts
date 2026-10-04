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
 *   - contact details and social links are shown only when set, and a link
 *     only if it really goes to the platform it's labelled with (15.0);
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

const { saveStorefrontAppearance, getStorefrontAppearance } = await import('@/features/settings/storefront');
const { saveHeroSlide, deleteHeroSlide, reorderHeroSlides } = await import('@/features/storefront/slides');
const { saveOrganizationSettings, getOrganizationSettings } = await import('@/features/settings/organization');

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
  ctx.membership.role.permissions = [
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_EDIT,
    PERMISSIONS.STOREFRONT_DESIGN,
  ];
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
    expect(look.tagline).toBeNull();
    expect(look.analytics).toEqual({ gaId: null, metaPixelId: null });
    expect(look.contact).toEqual({ email: null, phone: null, address: null });
    expect(look.social).toEqual([]);
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

  it('needs storefront.design — settings.edit alone no longer covers slides (15.1)', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];
    expect((await saveHeroSlide(null, slide())).success).toBe(false);
  });

  it('never reaches another workspace’s storefront', async () => {
    unwrap(await saveHeroSlide(null, slide({ title: 'Mine only' })));
    const theirs = await loadStorefrontLook(otherSlug);
    expect(theirs.hero).toEqual([]);
  });
});

describe('listing and tracking', () => {
  it('keeps what the merchant set', async () => {
    unwrap(
      await saveStorefrontAppearance({
        tagline: 'Hand-dyed adire, made in Abeokuta.',
        gaId: 'G-ABCD1234',
        metaPixelId: '1234567890123456',
      }),
    );

    const look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.tagline).toBe('Hand-dyed adire, made in Abeokuta.');
    expect(look.analytics).toEqual({ gaId: 'G-ABCD1234', metaPixelId: '1234567890123456' });
  });

  it('refuses a measurement id that isn’t shaped like one', async () => {
    expect((await saveStorefrontAppearance({ gaId: 'not-an-id' })).success).toBe(false);
    expect((await saveStorefrontAppearance({ metaPixelId: 'abc' })).success).toBe(false);
  });

  it('reads back for the settings screen', async () => {
    unwrap(await saveStorefrontAppearance({ tagline: 'Made in Abeokuta.' }));
    const data = unwrap(await getStorefrontAppearance());
    expect(data.appearance.tagline).toBe('Made in Abeokuta.');
  });
});

describe('contact and social links in the footer', () => {
  const business = { name: 'Look Test' };

  it('shows only what the merchant filled in, as links to those platforms', async () => {
    unwrap(
      await saveOrganizationSettings({
        ...business,
        supportEmail: 'hello@looktest.ng',
        socialLinks: { instagram: '@looktest', whatsapp: '0801 234 5678', facebook: '' },
      }),
    );

    const look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.contact).toEqual({ email: 'hello@looktest.ng', phone: null, address: null });
    expect(look.social).toEqual([
      { platform: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/looktest' },
      { platform: 'whatsapp', label: 'WhatsApp', url: 'https://wa.me/2348012345678' },
    ]);

    const settings = unwrap(await getOrganizationSettings());
    expect(settings.socialLinks.instagram).toBe('https://www.instagram.com/looktest');
    expect(settings.socialLinks.facebook).toBe('');
  });

  it('refuses a link labelled as one platform that goes somewhere else, and saves nothing', async () => {
    unwrap(await saveOrganizationSettings({ ...business, socialLinks: { tiktok: '@before' } }));
    const result = await saveOrganizationSettings({
      ...business,
      socialLinks: { tiktok: '@after', instagram: 'https://evil.example/instagram.com/x' },
    });
    expect(result.success).toBe(false);
    expect(result.success === false && 'fieldErrors' in result && result.fieldErrors['social.instagram']).toBeTruthy();

    const look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.social.map((link) => link.url)).toEqual(['https://www.tiktok.com/@before']);
  });

  it('clears them all when every box is emptied', async () => {
    unwrap(await saveOrganizationSettings({ ...business, socialLinks: { x: '@looktest' } }));
    unwrap(await saveOrganizationSettings({ ...business, socialLinks: { x: '' } }));
    const row = await prisma.organization.findUnique({
      where: { id: ctx.organization.id },
      select: { storefrontSocialLinks: true },
    });
    expect(row?.storefrontSocialLinks).toBeNull();
  });

  it('drops a stored link that no longer passes the rules', async () => {
    /* Whatever reaches an href is checked on the way out too. */
    await prisma.organization.update({
      where: { id: ctx.organization.id },
      data: { storefrontSocialLinks: { instagram: 'javascript:alert(1)', youtube: 'https://youtube.com/@looktest' } },
    });
    const look = await loadStorefrontLook(ctx.organization.slug);
    expect(look.social.map((link) => link.platform)).toEqual(['youtube']);
  });

  it('refuses a member without settings.edit', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    expect((await saveOrganizationSettings({ ...business, socialLinks: { x: '@nope' } })).success).toBe(false);
  });

  it('never reaches another workspace’s storefront', async () => {
    unwrap(await saveOrganizationSettings({ ...business, supportPhone: '0809 000 0000', socialLinks: { x: '@mine' } }));
    const other = await loadStorefrontLook(otherSlug);
    expect(other.social).toEqual([]);
    expect(other.contact.phone).toBeNull();
  });
});

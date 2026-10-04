/*
 * The shop's design, against the real database (ROADMAP 15.1).
 *
 * The rules that matter:
 *   - a shop that never opened the editor renders Classic from its old
 *     colour and dark setting — nothing written, nothing changed;
 *   - a draft is invisible to shoppers until it is published;
 *   - publishing is all-or-nothing, names the draft the merchant saw, and is
 *     audited; a stale draft is never published unseen;
 *   - a design that breaks the rules is refused, and one stored broken
 *     renders as Classic rather than failing;
 *   - only `storefront.design` may do any of it;
 *   - a preview link shows the draft only to a current team member of THAT
 *     shop with the permission;
 *   - nothing crosses to another workspace.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Design Test', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { loadStorefrontDesign } from '@/lib/storefront/data/design';
import { createPreviewToken, mayPreviewDesign, readPreviewToken } from '@/lib/storefront/design/preview';

const {
  getDesignEditor,
  saveDesignDraft,
  saveHomepageDraft,
  saveChromeDraft,
  applyStartingLookToDraft,
  publishDesign,
  discardDesignDraft,
  createDesignPreviewLink,
} = await import('@/features/storefront/design');
import { classicSections, type HomepageSection } from '@/lib/storefront/sections/schema';
import { forgetOrgStatus } from '@/lib/tenant/org-status';

vi.setConfig({ testTimeout: 90_000 });

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let otherOrgId = '';
let otherSlug = '';
let ownerId = '';
let designerId = '';
let clerkId = '';

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const editorial = {
  look: 'editorial' as const,
  brandColour: '#b42318',
  darkByDefault: false,
  corners: null,
  fonts: null,
  cards: 'framed' as const,
};

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Design Test', slug: `__test-design-${suffix}`, storefrontAccent: '#0f5132', storefrontDarkByDefault: true },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  otherSlug = `__test-design-other-${suffix}`;
  otherOrgId = (await prisma.organization.create({ data: { name: 'Other', slug: otherSlug } })).id;

  ownerId = (await prisma.user.create({ data: { name: 'Owner', email: `design-owner-${suffix}@example.com` } })).id;
  designerId = (await prisma.user.create({ data: { name: 'Designer', email: `design-designer-${suffix}@example.com` } })).id;
  clerkId = (await prisma.user.create({ data: { name: 'Clerk', email: `design-clerk-${suffix}@example.com` } })).id;

  const permission = await prisma.permission.upsert({
    where: { key: PERMISSIONS.STOREFRONT_DESIGN },
    create: { key: PERMISSIONS.STOREFRONT_DESIGN, module: 'storefront' },
    update: {},
  });
  const owner = await prisma.role.create({ data: { organizationId: org.id, name: SYSTEM_ROLES.OWNER.name, isSystem: true } });
  const designer = await prisma.role.create({
    data: { organizationId: org.id, name: 'Designer', rolePermissions: { create: { permissionId: permission.id } } },
  });
  const clerk = await prisma.role.create({ data: { organizationId: org.id, name: 'Clerk' } });
  await prisma.membership.createMany({
    data: [
      { userId: ownerId, organizationId: org.id, roleId: owner.id, status: 'ACTIVE' },
      { userId: designerId, organizationId: org.id, roleId: designer.id, status: 'ACTIVE' },
      { userId: clerkId, organizationId: org.id, roleId: clerk.id, status: 'ACTIVE' },
    ],
  });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.collection.deleteMany({ where: { organizationId } });
    await prisma.category.deleteMany({ where: { organizationId } });
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.storefrontDesign.deleteMany({ where: { organizationId } });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.role.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, designerId, clerkId] } } });
});

beforeEach(async () => {
  ctx.userId = ownerId;
  ctx.membership.role.permissions = [PERMISSIONS.STOREFRONT_DESIGN];
  await prisma.storefrontDesign.deleteMany({ where: { organizationId: ctx.organization.id } });
});

describe('a shop that never opened the editor', () => {
  it('renders Classic from its old colour and dark setting, and writes nothing', async () => {
    const view = await loadStorefrontDesign(ctx.organization.slug);
    expect(view.isDraft).toBe(false);
    expect(view.design).toMatchObject({ look: 'classic', brandColour: '#0f5132', darkByDefault: true });
    expect(view.resolved.attributes['data-sf-look']).toBe('classic');
    expect(await prisma.storefrontDesign.count({ where: { organizationId: ctx.organization.id } })).toBe(0);

    const editor = unwrap(await getDesignEditor());
    expect(editor.live.look).toBe('classic');
    expect(editor.draft).toBeNull();
    expect(editor.publishedAt).toBeNull();
  });
});

describe('draft and publish', () => {
  it('keeps a draft away from shoppers until it is published, then puts all of it live at once', async () => {
    const { draftSavedAt } = unwrap(await saveDesignDraft(editorial));

    expect((await loadStorefrontDesign(ctx.organization.slug)).design.look).toBe('classic');
    const draft = await loadStorefrontDesign(ctx.organization.slug, 'draft');
    expect(draft).toMatchObject({ isDraft: true, design: { look: 'editorial', cards: 'framed' } });

    unwrap(await publishDesign(draftSavedAt));

    const live = await loadStorefrontDesign(ctx.organization.slug);
    expect(live.design).toMatchObject({ look: 'editorial', brandColour: '#b42318', cards: 'framed' });
    const row = await prisma.storefrontDesign.findUnique({ where: { organizationId: ctx.organization.id } });
    expect(row?.draft).toBeNull();
    expect(row?.publishedById).toBe(ownerId);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: ctx.organization.id, action: 'storefront.design.published' },
    });
    expect(audit?.metadata).toMatchObject({ look: 'editorial', cards: 'framed' });

    const editor = unwrap(await getDesignEditor());
    expect(editor.live.look).toBe('editorial');
    expect(editor.publishedAt).not.toBeNull();
  });

  it('won’t publish a draft that was saved again since the merchant saw it', async () => {
    const { draftSavedAt: seen } = unwrap(await saveDesignDraft(editorial));
    await new Promise((resolve) => setTimeout(resolve, 5));
    unwrap(await saveDesignDraft({ ...editorial, look: 'bold' })); // another tab

    const result = await publishDesign(seen);
    expect(result.success).toBe(false);
    expect((await loadStorefrontDesign(ctx.organization.slug)).design.look).toBe('classic');
  });

  it('discards a draft without touching the live shop', async () => {
    const { draftSavedAt } = unwrap(await saveDesignDraft(editorial));
    unwrap(await publishDesign(draftSavedAt));
    unwrap(await saveDesignDraft({ ...editorial, look: 'playful', brandColour: null }));

    unwrap(await discardDesignDraft());
    expect(unwrap(await getDesignEditor()).draft).toBeNull();
    expect((await loadStorefrontDesign(ctx.organization.slug)).design.look).toBe('editorial');
    expect(
      await prisma.auditLog.count({
        where: { organizationId: ctx.organization.id, action: 'storefront.design.draft_discarded' },
      }),
    ).toBe(1);
  });

  it('refuses what breaks the rules', async () => {
    expect((await saveDesignDraft({ ...editorial, look: 'neon' as 'bold' })).success).toBe(false);
    // Too pale to stand out on the look's background — refused, with a shade offered.
    const pale = await saveDesignDraft({ ...editorial, look: 'minimal', brandColour: '#ffd6e0' });
    expect(pale.success).toBe(false);
    expect(!pale.success && pale.error).toMatch(/Try #[0-9a-f]{6}/);
    expect((await saveDesignDraft({ ...editorial, brandColour: 'red;}body{display:none' })).success).toBe(false);
  });

  it('renders Classic when what is stored can’t be read, rather than failing', async () => {
    await prisma.storefrontDesign.create({
      data: { organizationId: ctx.organization.id, published: { version: 1, look: 'neon', css: 'x' } },
    });
    expect((await loadStorefrontDesign(ctx.organization.slug)).design.look).toBe('classic');
  });
});

describe('who may', () => {
  it('needs storefront.design for every action — settings.edit is not enough', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];
    expect((await getDesignEditor()).success).toBe(false);
    expect((await saveDesignDraft(editorial)).success).toBe(false);
    expect((await publishDesign(new Date().toISOString())).success).toBe(false);
    expect((await discardDesignDraft()).success).toBe(false);
    expect((await createDesignPreviewLink()).success).toBe(false);
  });
});

describe('preview', () => {
  it('signs a link for this member of this shop, on the shop’s own address', async () => {
    const { url } = unwrap(await createDesignPreviewLink());
    const token = readPreviewToken(new URL(url).searchParams.get('token'));
    expect(url).toContain('/design-preview?token=');
    expect(token).toMatchObject({ organizationId: ctx.organization.id, userId: ownerId });
  });

  it('shows the draft only to a current member who may design this shop', async () => {
    const forOwner = readPreviewToken(createPreviewToken({ organizationId: ctx.organization.id, userId: ownerId }))!;
    const forDesigner = readPreviewToken(createPreviewToken({ organizationId: ctx.organization.id, userId: designerId }))!;
    const forClerk = readPreviewToken(createPreviewToken({ organizationId: ctx.organization.id, userId: clerkId }))!;

    expect(await mayPreviewDesign(forOwner, ctx.organization.id)).toBe(true); // Owner holds every permission
    expect(await mayPreviewDesign(forDesigner, ctx.organization.id)).toBe(true);
    expect(await mayPreviewDesign(forClerk, ctx.organization.id)).toBe(false);
    // A token for this shop is nothing in another.
    expect(await mayPreviewDesign(forOwner, otherOrgId)).toBe(false);

    // Removed from the team: the preview stops on the next page.
    await prisma.membership.updateMany({ where: { userId: designerId }, data: { status: 'SUSPENDED' } });
    expect(await mayPreviewDesign(forDesigner, ctx.organization.id)).toBe(false);
    await prisma.membership.updateMany({ where: { userId: designerId }, data: { status: 'ACTIVE' } });
  });

  it('refuses a token that was tampered with or has expired', () => {
    const token = createPreviewToken({ organizationId: ctx.organization.id, userId: ownerId });
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ organizationId: otherOrgId, userId: ownerId, expiresAt: Date.now() + 60_000 }),
    ).toString('base64url');
    expect(readPreviewToken(`${forged}.${signature}`)).toBeNull();
    expect(readPreviewToken(`${payload}.${signature}x`)).toBeNull();
    expect(readPreviewToken(token, Date.now() + 2 * 60 * 60 * 1000)).toBeNull();
    expect(readPreviewToken('garbage')).toBeNull();
  });
});

describe('another workspace', () => {
  it('is never touched by this shop’s drafts or publishes', async () => {
    const { draftSavedAt } = unwrap(await saveDesignDraft(editorial));
    unwrap(await publishDesign(draftSavedAt));

    const theirs = await loadStorefrontDesign(otherSlug);
    expect(theirs.design.look).toBe('classic');
    expect(theirs.design.brandColour).toBeNull();
    expect(await prisma.storefrontDesign.count({ where: { organizationId: otherOrgId } })).toBe(0);
  });
});

describe('the front page (15.3)', () => {
  const band = (source: Record<string, unknown>, title = 'Picks'): HomepageSection =>
    ({ id: 'picks', type: 'products', enabled: true, variant: 'grid', title, source }) as HomepageSection;
  const withBand = (source: Record<string, unknown>) => [classicSections()[0], band(source)];

  it('saves the arrangement without touching the look, and the look without touching the arrangement', async () => {
    unwrap(await saveDesignDraft(editorial));
    unwrap(await saveHomepageDraft(withBand({ kind: 'newest' })));
    let draft = (await loadStorefrontDesign(ctx.organization.slug, 'draft')).design;
    expect(draft.look).toBe('editorial');
    expect(draft.sections?.map((s) => s.id)).toEqual(['hero', 'picks']);

    unwrap(await saveDesignDraft({ ...editorial, look: 'bold' })); // the Look tab sends no sections
    draft = (await loadStorefrontDesign(ctx.organization.slug, 'draft')).design;
    expect(draft.look).toBe('bold');
    expect(draft.sections?.map((s) => s.id)).toEqual(['hero', 'picks']);
  });

  it('starts an arrangement from the live look when there is no draft', async () => {
    const { draftSavedAt } = unwrap(await saveDesignDraft(editorial));
    unwrap(await publishDesign(draftSavedAt));
    unwrap(await saveHomepageDraft(withBand({ kind: 'bestselling' })));
    expect((await loadStorefrontDesign(ctx.organization.slug, 'draft')).design.look).toBe('editorial');
  });

  it('refuses a band showing another shop’s collection, a hidden category, or one that doesn’t exist', async () => {
    const theirs = await prisma.collection.create({ data: { organizationId: otherOrgId, name: 'Theirs', slug: `theirs-${suffix}` } });
    const hidden = await prisma.category.create({
      data: { organizationId: ctx.organization.id, name: 'Old', slug: `old-${suffix}`, isVisible: false },
    });
    expect((await saveHomepageDraft(withBand({ kind: 'collection', id: theirs.id }))).success).toBe(false);
    expect((await saveHomepageDraft(withBand({ kind: 'category', id: hidden.id }))).success).toBe(false);
    expect((await saveHomepageDraft(withBand({ kind: 'brand', id: 'no-such-brand' }))).success).toBe(false);
    expect(await prisma.storefrontDesign.count({ where: { organizationId: ctx.organization.id } })).toBe(0);
  });

  it('refuses to publish a band whose collection was hidden after the draft was saved', async () => {
    const mine = await prisma.collection.create({
      data: { organizationId: ctx.organization.id, name: 'Mine', slug: `mine-${suffix}` },
    });
    const { draftSavedAt } = unwrap(await saveHomepageDraft(withBand({ kind: 'collection', id: mine.id })));
    await prisma.collection.update({ where: { id: mine.id }, data: { isVisible: false } });

    const result = await publishDesign(draftSavedAt);
    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatch(/“Picks”/);
    expect((await loadStorefrontDesign(ctx.organization.slug)).design.sections).toBeNull();
  });

  it('refuses an arrangement that breaks the rules — the top section must stay first', async () => {
    expect((await saveHomepageDraft([band({ kind: 'newest' })])).success).toBe(false);
    expect((await saveHomepageDraft([...withBand({ kind: 'newest' }), band({ kind: 'newest' })])).success).toBe(false);
  });

  it('needs storefront.design', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_EDIT];
    expect((await saveHomepageDraft(classicSections())).success).toBe(false);
  });

  it('aims the side-by-side preview at the platform address, even for a shop with its own domain', async () => {
    await prisma.organization.update({
      where: { id: ctx.organization.id },
      data: { customStoreDomain: `www.design-${suffix}.com` },
    });
    forgetOrgStatus(ctx.organization.slug); // routing is cached for a few seconds
    try {
      const framed = new URL(unwrap(await createDesignPreviewLink({ frame: true })).url);
      const tab = new URL(unwrap(await createDesignPreviewLink()).url);
      expect(framed.hostname.startsWith(`shop-${ctx.organization.slug}.`)).toBe(true);
      expect(tab.hostname).toBe(`www.design-${suffix}.com`);
    } finally {
      await prisma.organization.update({ where: { id: ctx.organization.id }, data: { customStoreDomain: null } });
      forgetOrgStatus(ctx.organization.slug);
    }
  });
});

describe('image and text (15.4)', () => {
  const picture = (organizationId: string) => ({
    url: `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/v1/mansaas/${organizationId}/storefront/story.jpg`,
    publicId: `mansaas/${organizationId}/storefront/story`,
  });
  const story = (image: { url: string; publicId: string } | null) =>
    [
      classicSections()[0],
      { id: 'story', type: 'image-text', enabled: true, heading: 'Our story', body: 'Since 2019.', image, imageSide: 'right', buttonLabel: '', buttonHref: '' },
    ] as HomepageSection[];

  it('saves a picture this shop uploaded', async () => {
    unwrap(await saveHomepageDraft(story(picture(ctx.organization.id))));
    const draft = (await loadStorefrontDesign(ctx.organization.slug, 'draft')).design;
    expect(draft.sections?.[1]).toMatchObject({ type: 'image-text', heading: 'Our story', imageSide: 'right' });
  });

  it('refuses a picture from another shop', async () => {
    const result = await saveHomepageDraft(story(picture(otherOrgId)));
    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatch(/wasn’t uploaded through this shop/);
  });
});

describe('header and footer (15.5)', () => {
  const footer = {
    columns: [
      { key: 'account', enabled: true },
      { key: 'shop', enabled: true },
      { key: 'help', enabled: false },
      { key: 'about', enabled: true },
      { key: 'links', enabled: true, title: 'Good to know', links: [{ label: 'Our story', href: '/pages/about' }] },
    ],
  };

  it('saves them without touching the look or the front page, and the look leaves them alone', async () => {
    unwrap(await saveDesignDraft(editorial));
    unwrap(await saveHomepageDraft(classicSections().slice(0, 2)));
    unwrap(await saveChromeDraft({ header: { layout: 'centered' }, footer }));
    let draft = (await loadStorefrontDesign(ctx.organization.slug, 'draft')).design;
    expect(draft).toMatchObject({ look: 'editorial', header: { layout: 'centered' }, footer });
    expect(draft.sections).toHaveLength(2);

    unwrap(await saveDesignDraft({ ...editorial, look: 'playful' })); // the Look tab sends neither
    draft = (await loadStorefrontDesign(ctx.organization.slug, 'draft')).design;
    expect(draft).toMatchObject({ look: 'playful', header: { layout: 'centered' }, footer });
  });

  it('goes live with the rest of the draft on publish', async () => {
    const { draftSavedAt } = unwrap(await saveChromeDraft({ header: { layout: 'search' }, footer }));
    expect((await loadStorefrontDesign(ctx.organization.slug)).design.header.layout).toBe('standard');
    unwrap(await publishDesign(draftSavedAt));
    expect((await loadStorefrontDesign(ctx.organization.slug)).design).toMatchObject({ header: { layout: 'search' }, footer });
  });

  it('refuses a link off the shop, and needs storefront.design', async () => {
    const bad = { columns: [{ key: 'links', enabled: true, title: 'Away', links: [{ label: 'Elsewhere', href: 'https://evil.example' }] }] };
    expect((await saveChromeDraft({ header: { layout: 'standard' }, footer: bad })).success).toBe(false);
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_EDIT];
    expect((await saveChromeDraft({ header: { layout: 'standard' }, footer })).success).toBe(false);
  });
});

describe('starting looks (15.6)', () => {
  it('suggests one from what the shop sells', async () => {
    await prisma.organization.update({ where: { id: ctx.organization.id }, data: { businessType: 'electronics' } });
    expect(unwrap(await getDesignEditor()).suggestedStartingLook).toBe('electronics');
    await prisma.organization.update({ where: { id: ctx.organization.id }, data: { businessType: null } });
    expect(unwrap(await getDesignEditor()).suggestedStartingLook).toBe('general');
  });

  it('goes into the draft only, keeping the colour, dark setting and footer', async () => {
    const footer = { columns: [{ key: 'shop', enabled: true }] };
    const { draftSavedAt } = unwrap(await saveDesignDraft({ ...editorial, darkByDefault: true }));
    unwrap(await saveChromeDraft({ header: { layout: 'standard' }, footer }));
    unwrap(await publishDesign(unwrap(await getDesignEditor()).draftSavedAt ?? draftSavedAt));

    const { colourSetAside } = unwrap(await applyStartingLookToDraft('electronics'));
    expect(colourSetAside).toBeNull();
    const draft = (await loadStorefrontDesign(ctx.organization.slug, 'draft')).design;
    expect(draft).toMatchObject({ look: 'bold', header: { layout: 'search' }, brandColour: '#b42318', darkByDefault: true, footer });
    expect(draft.startingLook).toBe('electronics');
    // Saving the look afterwards keeps the record of where it started.
    unwrap(await saveDesignDraft({ ...editorial, look: 'bold' }));
    expect((await loadStorefrontDesign(ctx.organization.slug, 'draft')).design.startingLook).toBe('electronics');
    expect((await loadStorefrontDesign(ctx.organization.slug)).design.look).toBe('editorial'); // live untouched
  });

  it('sets aside a colour that wouldn’t stand out on the new look, and says which', async () => {
    // Saved before the contrast rule existed: too pale for any look.
    await prisma.storefrontDesign.create({
      data: {
        organizationId: ctx.organization.id,
        published: { version: 2, look: 'classic', brandColour: '#ffd6e0', darkByDefault: false, corners: null, fonts: null, cards: null },
      },
    });
    const result = unwrap(await applyStartingLookToDraft('grocery'));
    expect(result.colourSetAside).toBe('#ffd6e0');
    expect((await loadStorefrontDesign(ctx.organization.slug, 'draft')).design).toMatchObject({ look: 'playful', brandColour: null });
  });

  it('refuses one that doesn’t exist, and needs storefront.design', async () => {
    expect((await applyStartingLookToDraft('neon')).success).toBe(false);
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_EDIT];
    expect((await applyStartingLookToDraft('fashion')).success).toBe(false);
  });
});

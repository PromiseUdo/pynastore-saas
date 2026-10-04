/*
 * Merchant onboarding (ROADMAP 12.5), against the real database: confirming
 * the email, "Create your shop", the setup guide read from real records,
 * opening the shop, the not-open storefront, and the reminders. Email is
 * captured, not sent.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { dropBilling } from './helpers/plans';
import { giveStoreDelivery } from './helpers/delivery';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock('@/lib/session', () => ({ updateCurrentOrganization: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: '', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', warehouseIds: [] as string[], role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const mail = vi.hoisted(() => [] as { to: string | string[]; subject: string; button?: { url: string }; list?: string[] }[]);
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendPlatformNoticeEmail: async (p: { to: string | string[]; subject: string; button?: { url: string }; list?: string[] }) => {
    mail.push(p);
    return true;
  },
}));

const fixturesWas = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const { sendVerificationEmail, confirmEmailToken } = await import('@/lib/email-verification');
const { createShop, checkShopAddress } = await import('@/app/onboarding/actions');
const { bootstrapOrganization } = await import('@/lib/onboarding/bootstrap');
const { getSetupProgress } = await import('@/lib/onboarding/setup-guide');
const { openStorefront, closeStorefront } = await import('@/features/onboarding/actions');
const { getCatalogue } = await import('@/lib/storefront/data/current');
const { placeOrder } = await import('@/lib/storefront/orders/create');
const { runOnboardingReminders } = await import('@/lib/onboarding/reminders');
const { SetupGuideSection } = await import('@/components/dashboard/setup-guide-section');
const sitemap = (await import('@/app/store/[organizationSlug]/sitemap')).default;

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY = 24 * 60 * 60 * 1000;
let userId = '';
let takenOrgId = '';
let shop = { id: '', slug: '' };
let productId = '';

const input = (over: Partial<Parameters<typeof createShop>[0]> = {}) => ({
  name: 'Onboarding Test',
  address: `obt-${suffix}`,
  businessType: 'fashion',
  salesChannels: 'BOTH',
  categories: ['Women', 'Shoes', 'Invented'],
  storeName: 'Main shop',
  state: 'Lagos',
  city: '  Ikeja ',
  ...over,
});

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: 'New Merchant', email: `obt-${suffix}@example.com` } })).id;
  session.user = { id: userId, email: `obt-${suffix}@example.com` };
  takenOrgId = (await prisma.organization.create({ data: { name: 'Taken', slug: `obt-taken-${suffix}` } })).id;
});

afterAll(async () => {
  process.env.STOREFRONT_FIXTURES = fixturesWas;
  const orgs = await prisma.organization.findMany({ where: { id: { in: [takenOrgId, shop.id].filter(Boolean) } }, select: { id: true } });
  for (const { id } of orgs) {
    await prisma.inventoryLevel.deleteMany({ where: { inventoryItem: { organizationId: id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: id } });
    await prisma.deliveryZone.deleteMany({ where: { organizationId: id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: id } });
    await prisma.category.deleteMany({ where: { organizationId: id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: id } });
    await dropBilling(id);
    await prisma.organization.delete({ where: { id } });
  }
  await prisma.verificationToken.deleteMany({ where: { identifier: `verify-email:${userId}` } });
  await prisma.user.delete({ where: { id: userId } });
});

describe('confirming the email', () => {
  it('sends a single-use link, and won’t resend within a minute', async () => {
    mail.length = 0;
    expect(await sendVerificationEmail(userId)).toBe('sent');
    expect(mail).toHaveLength(1);
    const raw = mail[0].button!.url.match(/\/verify-email\/([a-f0-9]{64})$/)![1];
    expect(await sendVerificationEmail(userId)).toBe('too-soon');

    expect(await createShop(input())).toMatchObject({ ok: false, error: expect.stringMatching(/Confirm your email/) });

    expect(await confirmEmailToken(raw)).toEqual({ ok: true, userId });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).not.toBeNull();
    expect(await confirmEmailToken(raw)).toEqual({ ok: false, reason: 'invalid' });
    expect(await sendVerificationEmail(userId)).toBe('already');
  });

  it('refuses an expired link', async () => {
    const raw = 'a'.repeat(64);
    await prisma.verificationToken.create({
      data: { identifier: `verify-email:${userId}`, token: createHash('sha256').update(raw).digest('hex'), expires: new Date(Date.now() - 1000) },
    });
    expect(await confirmEmailToken(raw)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('create your shop', () => {
  it('refuses a taken or reserved address with suggestions, and never suffixes it', async () => {
    const taken = await createShop(input({ address: `obt-taken-${suffix}` }));
    expect(taken).toMatchObject({ ok: false, fieldErrors: { address: expect.stringMatching(/already has that address/) } });
    if (!taken.ok) {
      expect(taken.suggestions!.length).toBeGreaterThan(0);
      expect(taken.suggestions).not.toContain(`obt-taken-${suffix}`);
    }
    expect(await prisma.organization.count({ where: { slug: { startsWith: `obt-taken-${suffix}-` } } })).toBe(0);

    expect(await createShop(input({ address: 'platform' }))).toMatchObject({ ok: false, fieldErrors: { address: expect.stringMatching(/kept for the platform/) } });
    expect(await checkShopAddress({ address: `obt-${suffix}` })).toEqual({ status: 'available', address: `obt-${suffix}` });
  });

  it('creates the shop, its first store, roles, owner, trial and ticked categories — closed', async () => {
    mail.length = 0;
    const result = await createShop(input());
    expect(result).toMatchObject({ ok: true });

    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: `obt-${suffix}` },
      include: {
        warehouses: true,
        categories: { orderBy: { sortOrder: 'asc' } },
        memberships: { include: { role: true } },
        subscription: true,
        onboardingEmails: true,
      },
    });
    shop = { id: org.id, slug: org.slug };
    expect(org).toMatchObject({ name: 'Onboarding Test', storefrontOpen: false, businessType: 'fashion', salesChannels: 'BOTH' });
    expect(org.warehouses).toEqual([expect.objectContaining({ name: 'Main shop', state: 'Lagos', city: 'Ikeja', sellsOnline: false })]);
    expect(org.categories.map((c) => c.name)).toEqual(['Women', 'Shoes']);
    expect(org.memberships).toEqual([expect.objectContaining({ userId, role: expect.objectContaining({ name: 'Owner' }) })]);
    expect(org.subscription?.status).toBe('TRIALING');
    expect(org.onboardingEmails.map((e) => e.kind)).toEqual(['welcome']);
    expect(mail[0].subject).toMatch(/Welcome/);

    // The starting look for a fashion shop, already published — nobody sees it until the shop opens (15.6).
    const design = await prisma.storefrontDesign.findUnique({ where: { organizationId: org.id } });
    expect(design?.published).toMatchObject({ look: 'editorial', header: { layout: 'centered' }, startingLook: 'fashion' });
    expect(design?.draft).toBeNull();
  });

  it('creates nothing at all when a later step fails', async () => {
    const slug = `obt-atomic-${suffix}`;
    await expect(
      bootstrapOrganization({ name: 'Atomic', slug, ownerUserId: 'no-such-user', firstStore: { name: 'X', state: 'Lagos', city: 'Ikeja' } }),
    ).rejects.toThrow();
    expect(await prisma.organization.count({ where: { slug } })).toBe(0);
  });
});

describe('the setup guide and opening', () => {
  it('reads each step from the real records, done and undone as they change', async () => {
    const step = async (key: string) => (await getSetupProgress(shop.id))!.steps.find((s) => s.key === key)!.done;
    expect(await step('store_place')).toBe(true);
    expect(await step('sells_online')).toBe(false);

    ctx.organization.id = shop.id;
    ctx.organization.slug = shop.slug;
    ctx.userId = userId;
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_EDIT];
    const refused = await openStorefront();
    expect(refused).toMatchObject({ success: false, error: expect.stringMatching(/can’t open yet/) });

    const store = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: shop.id } });
    await prisma.warehouse.update({ where: { id: store.id }, data: { sellsOnline: true } });
    expect(await step('sells_online')).toBe(true);
    expect(await step('delivery')).toBe(false);
    await giveStoreDelivery(shop.id);
    expect(await step('delivery')).toBe(true);

    productId = (
      await prisma.inventoryItem.create({
        data: { organizationId: shop.id, name: 'Ankara dress', sku: `OBT-${suffix}`, slug: `ankara-${suffix}`, sellingPrice: 15000, isPublished: true, status: 'ACTIVE' },
      })
    ).id;
    expect(await step('product')).toBe(false); // no stock yet
    await prisma.inventoryLevel.create({ data: { inventoryItemId: productId, warehouseId: store.id, quantity: 5 } });
    expect(await step('product')).toBe(true);
    expect((await getSetupProgress(shop.id))!.readyToOpen).toBe(true);

    await prisma.inventoryLevel.updateMany({ where: { inventoryItemId: productId }, data: { quantity: 0 } });
    expect(await step('product')).toBe(false);
    await prisma.inventoryLevel.updateMany({ where: { inventoryItemId: productId }, data: { quantity: 5 } });
  });

  it('keeps a not-open shop empty to shoppers — but not to its own team — and takes no order', async () => {
    session.user = null; // a shopper
    expect((await getCatalogue({ organizationSlug: shop.slug })).products).toHaveLength(0);
    expect(await sitemap({ params: Promise.resolve({ organizationSlug: shop.slug }) })).toEqual([]);

    session.user = { id: userId, email: `obt-${suffix}@example.com` }; // the owner, previewing
    expect((await getCatalogue({ organizationSlug: shop.slug })).products.map((p) => p.id)).toContain(productId);

    const placed = await placeOrder({
      organizationSlug: shop.slug,
      customerId: null,
      lines: [],
      contact: {} as never,
      address: {} as never,
      deliveryMethodId: '',
      paymentMethodId: '',
      note: '',
      config: {} as never,
    });
    expect(placed).toMatchObject({ ok: false, code: 'store-not-open' });
  });

  it('opens once everything required is done, and closes again', async () => {
    expect(await openStorefront()).toMatchObject({ success: true });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: shop.id } });
    expect(org.storefrontOpen).toBe(true);
    expect(org.storefrontOpenedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { organizationId: shop.id, action: 'settings.storefront.opened' } })).toBe(1);

    session.user = null;
    expect((await sitemap({ params: Promise.resolve({ organizationSlug: shop.slug }) })).length).toBeGreaterThan(0);

    expect(await closeStorefront()).toMatchObject({ success: true });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: shop.id } })).storefrontOpen).toBe(false);
    await prisma.organization.update({ where: { id: shop.id }, data: { storefrontOpen: false } });
  });

  it('shows the guide on the dashboard to an owner or admin only', async () => {
    ctx.membership.role = { id: 'r', name: 'Sales Rep', isSystem: false, permissions: [PERMISSIONS.SALES_VIEW] };
    expect(await SetupGuideSection({ variant: 'dashboard' })).toBeNull();
    ctx.membership.role = { id: 'r', name: 'Owner', isSystem: true, permissions: [PERMISSIONS.SETTINGS_EDIT] };
    expect(await SetupGuideSection({ variant: 'dashboard' })).not.toBeNull();
  });
});

describe('reminders', () => {
  it('nudges on day 3 while not open and warns before the trial ends — once each', async () => {
    await prisma.organization.update({ where: { id: shop.id }, data: { createdAt: new Date(Date.now() - 4 * DAY) } });
    await prisma.subscription.update({ where: { organizationId: shop.id }, data: { trialEndsAt: new Date(Date.now() + 2 * DAY) } });

    mail.length = 0;
    const first = await runOnboardingReminders({ only: [shop.id] });
    expect(first.sent).toMatchObject({ setup_day_3: 1, trial_ends_3d: 1 });
    expect(mail.map((m) => m.to)).toEqual([[`obt-${suffix}@example.com`], [`obt-${suffix}@example.com`]]);
    expect(mail[0].list).toContain('Open your shop');

    mail.length = 0;
    const second = await runOnboardingReminders({ only: [shop.id] });
    expect(second.sent).toEqual({ setup_day_3: 0, setup_day_7: 0, trial_ends_3d: 0, trial_ends_1d: 0 });
    expect(mail).toHaveLength(0);
  });
});

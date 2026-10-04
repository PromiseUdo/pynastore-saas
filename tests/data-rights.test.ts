/*
 * Data rights (ROADMAP 13.8), against a real database: a shopper's download
 * and deletion; closing a workspace, restoring it, the day-30 purge and the
 * year-6 erasure — the last proven by leaving NOT ONE row of the workspace in
 * any table while a second workspace and every user survive untouched.
 *
 * Run it on a throwaway database (`npm run test:local`): it builds whole
 * workspaces through the real onboarding, checkout and delivery flows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({ subjects: [] as string[] }));
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendPlatformNoticeEmail: vi.fn(async (p: { subject: string }) => {
    mail.subjects.push(p.subject);
    return true;
  }),
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
  sendLowStockAlertEmail: vi.fn(async () => {}),
}));
const paystack = vi.hoisted(() => ({ disabled: [] as string[] }));
vi.mock('@/lib/billing/paystack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/paystack')>()),
  disableSubscription: vi.fn(async (code: string) => {
    paystack.disabled.push(code);
  }),
}));
const cloudinary = vi.hoisted(() => ({ purged: [] as string[] }));
vi.mock('@/lib/cloudinary/sign', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cloudinary/sign')>()),
  destroyOrganizationAssets: vi.fn(async (orgId: string) => {
    cloudinary.purged.push(orgId);
    return 3;
  }),
}));

import { prisma } from '@/lib/prisma';
import { bootstrapOrganization } from '@/lib/onboarding/bootstrap';
import { giveStoreDelivery } from './helpers/delivery';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { placeOrder } from '@/lib/storefront/orders/create';
import { confirmOrder, markOrderDelivered, markOrderShipped } from '@/lib/storefront/orders/lifecycle';
import { deleteShopperAccount, exportShopperData } from '@/lib/data-rights/shopper';
import { closeWorkspace, restoreClosedWorkspace, WorkspaceClosureError } from '@/lib/data-rights/workspace';
import { runDataRetention } from '@/lib/data-rights/retention';
import { eraseOrganization } from '@/lib/data-rights/erase';

vi.setConfig({ testTimeout: 120_000 });
process.env.STOREFRONT_FIXTURES = '0';

const tag = `dr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY = 86_400_000;

interface Shop {
  orgId: string;
  slug: string;
  ownerId: string;
  shopperId: string;
  otherCustomerId: string;
  orderId: string;
}

/** A workspace with a bit of everything, built through the real flows where they exist. */
async function richShop(name: string): Promise<Shop> {
  const owner = await prisma.user.create({ data: { email: `${name}-owner-${tag}@example.com`, name: `${name} Owner` } });
  const slug = `${name}-${tag}`.toLowerCase();
  const org = await bootstrapOrganization({
    name: `${name} ${tag}`,
    slug,
    ownerUserId: owner.id,
    firstStore: { name: 'Main shop', state: 'Lagos', city: 'Ikeja' },
    categories: ['Clothing'],
  });
  const orgId = org.organization.id;
  await prisma.organization.update({ where: { id: orgId }, data: { storefrontOpen: true } });
  await prisma.warehouse.updateMany({ where: { organizationId: orgId }, data: { sellsOnline: true } });
  await prisma.subscription.updateMany({ where: { organizationId: orgId }, data: { paystackSubscriptionCode: `SUB_${name}_${tag}`, paystackEmailToken: 'tok', status: 'ACTIVE' } });
  const deliveryMethodId = await giveStoreDelivery(orgId);
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: orgId } });

  const brand = await prisma.brand.create({ data: { organizationId: orgId, name: 'Acme', slug: 'acme' } });
  const product = await prisma.inventoryItem.create({
    data: { organizationId: orgId, name: 'Linen shirt', sku: `LS-${tag}`, slug: `linen-${tag}`, sellingPrice: 5000, isPublished: true, status: 'ACTIVE', brandId: brand.id },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: product.id, warehouseId: warehouse.id, quantity: 20 } });
  await prisma.productImage.create({ data: { organizationId: orgId, inventoryItemId: product.id, url: 'https://res.cloudinary.com/x/y.jpg', publicId: `mansaas/${orgId}/products/y` } });
  const collection = await prisma.collection.create({ data: { organizationId: orgId, name: 'Summer', slug: 'summer' } });
  await prisma.collectionItem.create({ data: { collectionId: collection.id, inventoryItemId: product.id } });
  const campaign = await prisma.campaign.create({
    data: { organizationId: orgId, name: 'Sale', mechanic: 'PERCENT_OFF', value: 10, startsAt: new Date(), targetKind: 'PRODUCT' },
  });
  await prisma.campaignPrice.create({ data: { organizationId: orgId, campaignId: campaign.id, inventoryItemId: product.id, originalPrice: 5000, price: 4500 } });
  await prisma.discountCode.create({ data: { organizationId: orgId, code: 'WELCOME', label: 'Welcome', kind: 'PERCENT', value: 5 } });

  // The shopper, with an account and everything an account collects.
  const shopper = await prisma.customer.create({
    data: { organizationId: orgId, name: 'Ada Okoro', email: `ada-${tag}@example.com`, phone: '08012345678', passwordHash: 'x', notes: 'VIP', tags: ['vip'], marketingConsent: true },
  });
  await prisma.customerAddress.create({ data: { customerId: shopper.id, fullName: 'Ada Okoro', phone: '08012345678', line1: '12 Example St', city: 'Ikeja', state: 'Lagos' } });
  await prisma.customerWishlistItem.create({ data: { customerId: shopper.id, productId: product.id } });
  await prisma.customerOAuthAccount.create({ data: { customerId: shopper.id, organizationId: orgId, provider: 'google', providerAccountId: `g-${tag}-${name}` } });

  const placed = await placeOrder({
    organizationSlug: slug,
    customerId: shopper.id,
    lines: [{ productId: product.id, variantId: product.id, quantity: 1 }],
    contact: { firstName: 'Ada', lastName: 'Okoro', email: `ada-${tag}@example.com`, phone: '08012345678' },
    address: { firstName: 'Ada', lastName: 'Okoro', phone: '08012345678', country: 'NG', state: 'Lagos', city: 'Ikeja', addressLine1: '12 Example St', addressLine2: '', postalCode: '' },
    deliveryMethodId,
    paymentMethodId: 'pod',
    note: 'Leave at the gate',
    config: await getStoreCheckoutConfig({ organizationSlug: slug }),
  });
  if (!placed.ok) throw new Error(placed.message);
  const scope = { organizationId: orgId, orderId: placed.orderId };
  expect((await confirmOrder(scope)).ok).toBe(true);
  expect((await markOrderShipped({ ...scope, organizationSlug: slug, performedById: null })).ok).toBe(true);
  expect((await markOrderDelivered({ ...scope, paymentCollected: true })).ok).toBe(true);

  const review = await prisma.productReview.create({
    data: { organizationId: orgId, productId: product.id, customerId: shopper.id, orderId: placed.orderId, rating: 5, title: 'Lovely', body: 'Fits well' },
  });
  await prisma.productQuestion.create({ data: { organizationId: orgId, productId: product.id, customerId: shopper.id, body: 'Is it lined?' } });

  // A business customer with an invoice and a quote.
  const other = await prisma.customer.create({ data: { organizationId: orgId, name: 'Bola Ltd', email: `bola-${tag}@example.com` } });
  await prisma.productReviewVote.create({ data: { reviewId: review.id, customerId: other.id } });
  const invoice = await prisma.invoice.create({
    data: { organizationId: orgId, customerId: other.id, invoiceNumber: `INV-${tag}`, subtotal: 5000, totalAmount: 5000, status: 'SENT', warehouseId: warehouse.id },
  });
  await prisma.invoiceLineItem.create({ data: { invoiceId: invoice.id, description: 'Shirts', quantity: 1, unitPrice: 5000, totalPrice: 5000, inventoryItemId: product.id } });
  await prisma.payment.create({ data: { organizationId: orgId, invoiceId: invoice.id, amount: 5000, method: 'CASH' } });
  const quote = await prisma.quote.create({ data: { organizationId: orgId, customerId: other.id, quoteNumber: `Q-${tag}`, subtotal: 5000, totalAmount: 5000 } });
  await prisma.quoteLineItem.create({ data: { quoteId: quote.id, description: 'Shirts', quantity: 1, unitPrice: 5000, totalPrice: 5000 } });

  // Store content, staff and the platform relationship.
  await prisma.storePage.create({ data: { organizationId: orgId, kind: 'ABOUT', title: 'About', slug: 'about', body: 'We sell shirts.' } });
  await prisma.storefrontHeroSlide.create({ data: { organizationId: orgId, title: 'Summer' } });
  const connection = await prisma.socialConnection.create({
    data: { organizationId: orgId, platform: 'FACEBOOK_PAGE', platformAccountId: `p-${tag}-${name}`, accountName: 'Page', accessTokenCipher: '', status: 'DISCONNECTED' },
  });
  await prisma.socialPost.create({
    data: { organizationId: orgId, connectionId: connection.id, platform: 'FACEBOOK_PAGE', accountName: 'Page', caption: 'New in', idempotencyKey: `k-${tag}-${name}` },
  });
  const staff = await prisma.user.create({ data: { email: `${name}-staff-${tag}@example.com`, name: 'Staff' } });
  const role = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, name: { not: 'Owner' } } });
  await prisma.membership.create({ data: { userId: staff.id, organizationId: orgId, roleId: role.id } });
  await prisma.invitation.create({ data: { organizationId: orgId, email: `invitee-${tag}@example.com`, roleId: role.id, expiresAt: new Date(Date.now() + 7 * DAY) } });
  await prisma.merchantBankAccount.create({ data: { organizationId: orgId, bankName: 'Bank', accountName: 'Shop', accountNumber: '0123456789' } });
  await prisma.auditLog.create({ data: { organizationId: orgId, action: 'test.made', entityType: 'Test', entityId: 'x' } });

  return { orgId, slug, ownerId: owner.id, shopperId: shopper.id, otherCustomerId: other.id, orderId: placed.orderId };
}

/** Rows belonging to a workspace, in every table that has an organizationId column. */
async function rowsOf(orgId: string): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organizationId'`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table_name}" WHERE "organizationId" = $1`, orgId);
    if (Number(n) > 0) counts[table_name] = Number(n);
  }
  return counts;
}

let a: Shop;
let b: Shop;

beforeAll(async () => {
  a = await richShop('Closer');
  b = await richShop('Keeper');
});

afterAll(async () => {
  for (const shop of [a, b]) {
    if (!shop) continue;
    if (await prisma.organization.findUnique({ where: { id: shop.orgId } })) {
      await prisma.$transaction((tx) => eraseOrganization(tx, shop.orgId), { timeout: 120_000 });
    }
  }
  await prisma.user.deleteMany({ where: { email: { contains: tag } } });
  delete process.env.STOREFRONT_FIXTURES;
});

describe('a shopper’s rights', () => {
  it('gives them everything the store holds about them, in one file', async () => {
    const data = await exportShopperData(b.orgId, b.shopperId);
    expect(data?.profile).toMatchObject({ name: 'Ada Okoro', email: `ada-${tag}@example.com`, marketingConsent: true, signInWith: ['password', 'google'] });
    expect(data?.savedAddresses).toHaveLength(1);
    expect(data?.wishlist.map((w) => w.product)).toEqual(['Linen shirt']);
    expect(data?.orders).toHaveLength(1);
    expect(data?.orders[0].items[0]).toMatchObject({ name: 'Linen shirt', quantity: 1 });
    expect(data?.reviews.map((r) => r.title)).toEqual(['Lovely']);
    expect(data?.questions.map((q) => q.question)).toEqual(['Is it lined?']);
    expect(await exportShopperData(a.orgId, b.shopperId)).toBeNull(); // another store's customer
  });

  it('deletes the account, keeping only the order the law needs — and the store can’t reach them', async () => {
    expect(await deleteShopperAccount(b.orgId, b.shopperId)).toBe('records-kept');
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: b.shopperId } });
    expect(c).toMatchObject({ name: 'Ada Okoro', email: null, phone: null, notes: null, tags: [], passwordHash: null, marketingConsent: false });
    expect(c.accountDeletedAt).not.toBeNull();
    for (const [model, where] of [
      [prisma.customerAddress, { customerId: b.shopperId }],
      [prisma.customerWishlistItem, { customerId: b.shopperId }],
      [prisma.customerOAuthAccount, { customerId: b.shopperId }],
      [prisma.productReview, { customerId: b.shopperId }],
      [prisma.productQuestion, { customerId: b.shopperId }],
    ] as const) {
      expect(await (model as { count: (a: unknown) => Promise<number> }).count({ where })).toBe(0);
    }
    const order = await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } });
    expect(order).toMatchObject({ firstName: 'Ada', shipLine1: '12 Example St', anonymizedAt: null });
    expect(await deleteShopperAccount(b.orgId, b.shopperId)).toBeNull(); // already gone
  });

  it('deletes a customer outright when nothing ties them to business records', async () => {
    const lone = await prisma.customer.create({ data: { organizationId: b.orgId, name: 'Lone', email: `lone-${tag}@example.com`, passwordHash: 'x' } });
    expect(await deleteShopperAccount(b.orgId, lone.id)).toBe('deleted');
    expect(await prisma.customer.findUnique({ where: { id: lone.id } })).toBeNull();
  });

  it('anonymises their orders and name once six years have passed — and leaves everyone else alone', async () => {
    const later = new Date(Date.now() + (6 * 365 + 3) * DAY);
    const result = await runDataRetention({ now: later, only: [b.orgId] });
    expect(result.ordersAnonymized).toBe(1);
    expect(result.customersAnonymized).toBe(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } });
    expect(order).toMatchObject({ firstName: null, email: null, shipLine1: null, note: null });
    expect(order.anonymizedAt).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: b.shopperId } })).name).toBe('Deleted customer');
    // A customer who never deleted anything is the merchant's record, untouched.
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: b.otherCustomerId } })).email).toBe(`bola-${tag}@example.com`);
  });
});

describe('closing a workspace', () => {
  it('asks for the exact name, then takes it offline, stops the plan and tells the Owners', async () => {
    await expect(closeWorkspace({ organizationId: a.orgId, userId: a.ownerId, confirmName: 'wrong' })).rejects.toBeInstanceOf(WorkspaceClosureError);
    const { restorableUntil } = await closeWorkspace({ organizationId: a.orgId, userId: a.ownerId, confirmName: `Closer ${tag}`, reason: 'Moving on' });
    expect(restorableUntil.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: a.orgId } });
    expect(org).toMatchObject({ status: 'DELETED', closedById: a.ownerId, storefrontOpen: false });
    expect(paystack.disabled).toContain(`SUB_Closer_${tag}`);
    expect(mail.subjects).toContain(`Closer ${tag} is closed`);
    expect(await prisma.auditLog.count({ where: { organizationId: a.orgId, action: 'settings.organization.closed' } })).toBe(1);
  });

  it('can be restored by staff within the 30 days, and closed again', async () => {
    await restoreClosedWorkspace(a.orgId, a.ownerId);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.orgId } })).status).toBe('ACTIVE');
    await closeWorkspace({ organizationId: a.orgId, userId: a.ownerId, confirmName: `Closer ${tag}` });
  });

  it('after 30 days keeps only the business records', async () => {
    const before = await rowsOf(a.orgId);
    const result = await runDataRetention({ now: new Date(Date.now() + 31 * DAY), only: [a.orgId] });
    expect(result).toMatchObject({ workspacesPurged: 1, filesDeleted: 3, failed: 0 });
    expect(cloudinary.purged).toEqual([a.orgId]);

    const after = await rowsOf(a.orgId);
    for (const gone of ['product_images', 'store_pages', 'storefront_hero_slides', 'storefront_designs', 'social_posts', 'social_connections', 'memberships', 'invitations', 'merchant_bank_accounts', 'product_reviews', 'product_questions', 'customer_oauth_accounts']) {
      expect(after[gone], gone).toBeUndefined();
    }
    for (const kept of ['orders', 'invoices', 'payments', 'quotes', 'inventory_items', 'warehouses', 'stock_movements', 'customers']) {
      expect(after[kept], kept).toBe(before[kept]);
    }
    const customers = await prisma.customer.findMany({ where: { organizationId: a.orgId } });
    expect(customers.every((c) => c.email === null && c.phone === null && c.passwordHash === null)).toBe(true);
    await expect(restoreClosedWorkspace(a.orgId, a.ownerId)).rejects.toThrow(/more than 30 days/);
  });

  it('after six years is erased completely — and nothing of any other workspace or user goes with it', async () => {
    const keeperBefore = await rowsOf(b.orgId);
    const result = await runDataRetention({ now: new Date(Date.now() + (6 * 365 + 3) * DAY), only: [a.orgId] });
    expect(result.workspacesErased).toBe(1);

    expect(await prisma.organization.findUnique({ where: { id: a.orgId } })).toBeNull();
    expect(await rowsOf(a.orgId)).toEqual({});
    expect(await rowsOf(b.orgId)).toEqual(keeperBefore);
    expect(await prisma.user.findUnique({ where: { id: a.ownerId } })).not.toBeNull();
  });
});

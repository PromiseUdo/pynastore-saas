/*
 * Customer reviews, against the real database.
 *
 * The rule the whole feature rests on: a review can only come from an
 * account that received the product. Everything else here — the average, the
 * one-per-shopper rule, hiding, helpful votes — is checked against that same
 * gate, because a review system that can be written to by anyone is worse
 * than no review system at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { registerShopper } from '@/lib/storefront/account/shopper';
import {
  listPublishedReviews,
  ratingSummaries,
  reviewOpportunity,
  awaitingReview,
} from '@/lib/storefront/reviews/read';
import { deleteOwnReview, submitReview, toggleHelpful } from '@/lib/storefront/reviews/write';
import { getProductById } from '@/lib/storefront/catalog';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-reviews-${suffix}` };
const other = { id: '', slug: `__test-reviews-other-${suffix}` };

let productId = '';
let unreceivedProductId = '';
let foreignProductId = '';
let ada = '';
let tunde = '';

/* Reviews hang off real orders and real products, so the catalogue must read
 * the database rather than the demo fixtures. See lib/storefront/data/current.ts. */
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const GOOD = {
  rating: 5,
  title: 'Holds everything',
  body: 'Two weeks in and it still looks new. The strap is wider than it looks in the photos.',
};

async function makeProduct(organizationId: string, name: string) {
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId,
      name,
      sku: `${name}-${suffix}`.slice(0, 40),
      slug: `${name.toLowerCase()}-${suffix}`.slice(0, 60),
      sellingPrice: 5000,
      isPublished: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  const warehouse = await prisma.warehouse.create({
    data: { organizationId, name: `${name} Store`, sellsOnline: true, status: 'ACTIVE' },
  });
  await prisma.inventoryLevel.create({
    data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 50 },
  });

  return item.id;
}

/** An order for `lines`, in whatever state the test needs it to be in. */
async function makeOrder(input: {
  organizationId: string;
  customerId: string;
  productId: string;
  status: 'DELIVERED' | 'SHIPPED';
}) {
  return prisma.order.create({
    data: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      reference: `ORD-TEST-${Math.random().toString(36).slice(2, 10)}`,
      confirmationToken: Math.random().toString(36).slice(2) + Date.now(),
      status: input.status,
      paymentStatus: 'PAID',
      paymentMethod: 'card',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Okoro',
      phone: '08012345678',
      shipFullName: 'Ada Okoro',
      shipPhone: '08012345678',
      shipLine1: '12 Example Street',
      shipCity: 'Port Harcourt',
      shipState: 'Rivers',
      shipCountry: 'Nigeria',
      deliveryMethodId: 'rate_test',
      deliveryMethodLabel: 'Standard',
      deliveryFee: 2500,
      deliveryEtaMinDays: 2,
      deliveryEtaMaxDays: 4,
      subtotal: 5000,
      discount: 0,
      taxAmount: 0,
      totalAmount: 7500,
      currency: 'NGN',
      deliveredAt: input.status === 'DELIVERED' ? new Date() : null,
      lineItems: {
        create: [
          {
            productId: input.productId,
            name: 'Tote',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
            slug: `tote-${suffix}`,
          },
        ],
      },
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Reviews Store', slug: store.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug } })).id;

  productId = await makeProduct(store.id, 'Tote');
  unreceivedProductId = await makeProduct(store.id, 'Satchel');
  foreignProductId = await makeProduct(other.id, 'Foreign');

  for (const [name, email] of [
    ['Ada Okoro', `ada-${suffix}@example.com`],
    ['Tunde Bello', `tunde-${suffix}@example.com`],
  ]) {
    const result = await registerShopper({
      organizationId: store.id,
      name,
      email,
      password: 'a password here',
    });
    if (!result.ok) throw new Error('setup failed');
    if (name.startsWith('Ada')) ada = result.customer.id;
    else tunde = result.customer.id;
  }

  // Ada received the tote; Tunde received one too (so he can review it).
  await makeOrder({ organizationId: store.id, customerId: ada, productId, status: 'DELIVERED' });
  await makeOrder({ organizationId: store.id, customerId: tunde, productId, status: 'DELIVERED' });
  // …and Ada's satchel is still in transit.
  await makeOrder({
    organizationId: store.id,
    customerId: ada,
    productId: unreceivedProductId,
    status: 'SHIPPED',
  });
});

beforeEach(async () => {
  await prisma.productReview.deleteMany({ where: { organizationId: store.id } });
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;

  for (const org of [store, other]) {
    await prisma.productReview.deleteMany({ where: { organizationId: org.id } });
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: org.id } } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: org.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

const submit = (customerId: string, id: string, over: Partial<typeof GOOD> = {}) =>
  submitReview({ organizationId: store.id, customerId, productId: id, ...GOOD, ...over });

describe('who may write a review', () => {
  it('lets a shopper review what was delivered to them', async () => {
    const result = await submit(ada, productId);
    expect(result.ok).toBe(true);
  });

  it('refuses a product that hasn’t arrived yet', async () => {
    const result = await submit(ada, unreceivedProductId);
    expect(result).toMatchObject({ ok: false, code: 'not-purchased' });
  });

  it('refuses a product bought from a different store', async () => {
    const result = await submit(ada, foreignProductId);
    expect(result).toMatchObject({ ok: false, code: 'not-purchased' });
  });

  it('refuses a review that says nothing, before it asks about the order', async () => {
    const result = await submit(ada, productId, { body: 'Nice' });
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    if (result.ok) return;
    expect(result.fieldErrors?.body).toBeTruthy();
  });

  it('tells the page whether to offer a form, and what was written before', async () => {
    const before = await reviewOpportunity({ organizationId: store.id, customerId: ada, productId });
    expect(before).toMatchObject({ canReview: true, own: null });

    await submit(ada, productId);

    const after = await reviewOpportunity({ organizationId: store.id, customerId: ada, productId });
    expect(after.own).toMatchObject({ rating: 5, title: GOOD.title, status: 'PUBLISHED' });
  });

  it('offers a guest nothing', async () => {
    const guest = await reviewOpportunity({ organizationId: store.id, customerId: null, productId });
    expect(guest).toEqual({ canReview: false, orderId: null, own: null });
  });
});

describe('one shopper, one opinion', () => {
  it('replaces the earlier review rather than counting it twice', async () => {
    await submit(ada, productId);
    const second = await submit(ada, productId, { rating: 3, title: 'Changed my mind' });

    expect(second).toMatchObject({ ok: true, created: false });

    const reviews = await listPublishedReviews(store.id, productId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ rating: 3, title: 'Changed my mind' });
  });

  it('lets a shopper take their own review down', async () => {
    await submit(ada, productId);
    await deleteOwnReview({ organizationId: store.id, customerId: ada, productId });
    expect(await listPublishedReviews(store.id, productId)).toHaveLength(0);
  });
});

describe('what a shopper sees', () => {
  it('publishes the first name and last initial, and marks the purchase verified', async () => {
    await submit(ada, productId);
    const [review] = await listPublishedReviews(store.id, productId);
    expect(review.author).toBe('Ada O.');
    expect(review.verified).toBe(true);
  });

  it('feeds the product’s rating in the catalogue', async () => {
    await submit(ada, productId, { rating: 5 });
    await submit(tunde, productId, { rating: 4 });

    const summaries = await ratingSummaries(store.id);
    expect(summaries.get(productId)).toMatchObject({ average: 4.5, count: 2 });

    const product = await getProductById(productId, { organizationSlug: store.slug });
    expect(product?.rating).toMatchObject({ average: 4.5, count: 2 });
  });

  it('leaves a product nobody reviewed unrated rather than zero-rated', async () => {
    const product = await getProductById(unreceivedProductId, { organizationSlug: store.slug });
    expect(product?.rating).toMatchObject({ average: 0, count: 0 });
  });

  it('keeps one store’s reviews out of another’s', async () => {
    await submit(ada, productId);
    expect(await listPublishedReviews(other.id, productId)).toHaveLength(0);
    expect((await ratingSummaries(other.id)).size).toBe(0);
  });
});

describe('hiding a review', () => {
  it('takes it off the storefront and out of the average, and restores it whole', async () => {
    await submit(ada, productId, { rating: 5 });
    await submit(tunde, productId, { rating: 1 });

    const [{ id: hiddenId }] = await prisma.productReview.findMany({
      where: { organizationId: store.id, customerId: tunde },
      select: { id: true },
    });

    await prisma.productReview.update({
      where: { id: hiddenId },
      data: { status: 'HIDDEN', hiddenReason: 'Abusive', hiddenAt: new Date() },
    });

    expect(await listPublishedReviews(store.id, productId)).toHaveLength(1);
    expect((await ratingSummaries(store.id)).get(productId)).toMatchObject({ average: 5, count: 1 });

    await prisma.productReview.update({
      where: { id: hiddenId },
      data: { status: 'PUBLISHED', hiddenReason: null, hiddenAt: null },
    });

    expect((await ratingSummaries(store.id)).get(productId)).toMatchObject({ average: 3, count: 2 });
  });

  it('puts an edited review back on the storefront', async () => {
    await submit(ada, productId);
    await prisma.productReview.updateMany({
      where: { organizationId: store.id, customerId: ada },
      data: { status: 'HIDDEN', hiddenReason: 'Contained a phone number' },
    });

    await submit(ada, productId, { title: 'Rewritten', body: GOOD.body });

    const [review] = await prisma.productReview.findMany({
      where: { organizationId: store.id, customerId: ada },
      select: { status: true, hiddenReason: true },
    });
    expect(review).toMatchObject({ status: 'PUBLISHED', hiddenReason: null });
  });
});

describe('helpful votes', () => {
  it('counts one per shopper and takes it back when pressed again', async () => {
    await submit(ada, productId);
    const [{ id: reviewId }] = await prisma.productReview.findMany({
      where: { organizationId: store.id },
      select: { id: true },
    });

    const vote = { organizationId: store.id, customerId: tunde, reviewId };
    expect(await toggleHelpful(vote)).toMatchObject({ ok: true, helpful: 1, voted: true });
    expect(await toggleHelpful(vote)).toMatchObject({ ok: true, helpful: 0, voted: false });
  });

  it('refuses a shopper voting for their own', async () => {
    await submit(ada, productId);
    const [{ id: reviewId }] = await prisma.productReview.findMany({
      where: { organizationId: store.id },
      select: { id: true },
    });

    expect(await toggleHelpful({ organizationId: store.id, customerId: ada, reviewId })).toMatchObject({
      ok: false,
    });
  });
});

describe('what the account page offers to review', () => {
  it('lists delivered products that haven’t been reviewed, and drops them once they are', async () => {
    const before = await awaitingReview({ organizationId: store.id, customerId: ada });
    expect(before.map((item) => item.productId)).toEqual([productId]);

    await submit(ada, productId);

    const after = await awaitingReview({ organizationId: store.id, customerId: ada });
    expect(after).toHaveLength(0);
  });
});

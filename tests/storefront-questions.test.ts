/*
 * Product questions and answers, against the real database.
 *
 * The rule the feature rests on: nothing a shopper types is on the
 * storefront until the merchant answers it. Everything else here — tenancy,
 * who sees a waiting question, what hiding does — is checked against that
 * same gate, because an open box on a public page that publishes itself is
 * an open box anyone can write a store's copy with.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { registerShopper } from '@/lib/storefront/account/shopper';
import { listAnsweredQuestions, pendingQuestionsOf } from '@/lib/storefront/questions/read';
import { askQuestion } from '@/lib/storefront/questions/write';
import { getProductQuestions } from '@/lib/storefront/catalog';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-questions-${suffix}` };
const other = { id: '', slug: `__test-questions-other-${suffix}` };

let productId = '';
let foreignProductId = '';
let ada = '';
let tunde = '';

/* Questions hang off real products, so the catalogue must read the database
 * rather than the demo fixtures. See lib/storefront/data/current.ts. */
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const QUESTION = 'Does this come with a charger in the box?';

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

/** What the merchant's "Publish answer" does, without the admin session. */
async function answer(questionId: string, body: string) {
  await prisma.productQuestion.update({
    where: { id: questionId },
    data: { answerBody: body, answeredAt: new Date(), status: 'ANSWERED' },
  });
}

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Questions Store', slug: store.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug } })).id;

  productId = await makeProduct(store.id, 'Kettle');
  foreignProductId = await makeProduct(other.id, 'Foreign');

  for (const [name, email] of [
    ['Ada Okoro', `ada-q-${suffix}@example.com`],
    ['Tunde Bello', `tunde-q-${suffix}@example.com`],
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
});

beforeEach(async () => {
  await prisma.productQuestion.deleteMany({ where: { organizationId: store.id } });
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;

  for (const org of [store, other]) {
    await prisma.productQuestion.deleteMany({ where: { organizationId: org.id } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: org.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

const ask = (customerId: string, id: string, body = QUESTION) =>
  askQuestion({ organizationId: store.id, customerId, productId: id, body });

describe('asking', () => {
  it('takes a question from a signed-in shopper, and leaves it off the store', async () => {
    const result = await ask(ada, productId);
    expect(result.ok).toBe(true);

    const row = await prisma.productQuestion.findFirstOrThrow({
      where: { organizationId: store.id },
      select: { status: true, body: true, answerBody: true },
    });
    expect(row).toMatchObject({ status: 'PENDING', body: QUESTION, answerBody: null });
    expect(await listAnsweredQuestions(store.id, productId)).toEqual([]);
  });

  it('refuses a product belonging to another store', async () => {
    expect(await ask(ada, foreignProductId)).toMatchObject({ ok: false, code: 'unknown-product' });
    expect(await prisma.productQuestion.count({ where: { organizationId: store.id } })).toBe(0);
  });

  it('refuses a question too short to answer, before it looks anything up', async () => {
    expect(await ask(ada, productId, 'huh?')).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('stops a shopper stacking up questions on one product', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await ask(ada, productId, `${QUESTION} (${i})`)).ok).toBe(true);
    }
    expect(await ask(ada, productId, 'And what colour is the lid exactly?')).toMatchObject({
      ok: false,
      code: 'duplicate',
    });
  });
});

describe('what a shopper sees', () => {
  it('publishes the pair once the merchant answers, and names the store as one voice', async () => {
    const asked = await ask(ada, productId);
    if (!asked.ok) throw new Error('setup failed');
    await answer(asked.questionId, 'Yes — a charger and a spare filter.');

    const [question] = await listAnsweredQuestions(store.id, productId);
    expect(question.body).toBe(QUESTION);
    expect(question.author).toBe('Ada O.');
    expect(question.answers).toHaveLength(1);
    expect(question.answers[0]).toMatchObject({
      body: 'Yes — a charger and a spare filter.',
      source: 'merchant',
    });
  });

  it('shows a waiting question to the shopper who asked it and to nobody else', async () => {
    await ask(ada, productId);

    const mine = await pendingQuestionsOf({ organizationId: store.id, customerId: ada, productId });
    expect(mine.map((q) => q.body)).toEqual([QUESTION]);

    expect(await pendingQuestionsOf({ organizationId: store.id, customerId: tunde, productId })).toEqual([]);
    expect(await pendingQuestionsOf({ organizationId: store.id, customerId: null, productId })).toEqual([]);
  });

  it('takes an answered question back off the store when the merchant hides it', async () => {
    const asked = await ask(ada, productId);
    if (!asked.ok) throw new Error('setup failed');
    await answer(asked.questionId, 'Yes.');
    expect(await listAnsweredQuestions(store.id, productId)).toHaveLength(1);

    await prisma.productQuestion.update({
      where: { id: asked.questionId },
      data: { status: 'HIDDEN', hiddenReason: 'Contains a phone number', hiddenAt: new Date() },
    });
    expect(await listAnsweredQuestions(store.id, productId)).toEqual([]);
  });

  it('reads the same list through the catalogue seam the product page uses', async () => {
    const asked = await ask(ada, productId);
    if (!asked.ok) throw new Error('setup failed');
    await answer(asked.questionId, 'Yes, it does.');

    const questions = await getProductQuestions(productId, { organizationSlug: store.slug });
    expect(questions.map((q) => q.body)).toEqual([QUESTION]);
  });

  it('never serves one store’s questions under another store’s slug', async () => {
    const asked = await ask(ada, productId);
    if (!asked.ok) throw new Error('setup failed');
    await answer(asked.questionId, 'Yes, it does.');

    expect(await getProductQuestions(productId, { organizationSlug: other.slug })).toEqual([]);
    expect(await listAnsweredQuestions(other.id, productId)).toEqual([]);
  });
});

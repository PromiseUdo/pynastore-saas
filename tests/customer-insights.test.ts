/*
 * Customer metrics, segments and merging — against the real database.
 *
 * The rules that matter:
 *   - cancelled orders are not custom, so they count towards nothing;
 *   - a segment narrows and never widens, and an unrecognised one is ignored
 *     rather than silently returning nothing;
 *   - merging moves every trace of one person onto the other, counts their
 *     figures together, and leaves the old record out of the list;
 *   - a merged record can't be merged again, into itself, or across stores;
 *   - nothing here ever reaches another workspace's customers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  organization: {
    id: '',
    name: 'Insights Test',
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

const { listCustomerInsights, exportCustomerInsights } = await import('@/features/sales/customer-insights');
const { getCustomerDetail, mergeCustomers, findMergeCandidates, updateCustomerNotes, setMarketingConsent } =
  await import('@/features/sales/customer-detail');

vi.setConfig({ testTimeout: 90_000 });

let otherOrgId = '';
let reference = 0;

async function customer(name: string, extra: Record<string, unknown> = {}, organizationId = ctx.organization.id) {
  return prisma.customer.create({
    data: { organizationId, name, ...extra },
    select: { id: true, name: true },
  });
}

/** An order for `total`, `daysAgo` days back. */
async function order(
  customerId: string,
  total: number,
  options: { daysAgo?: number; status?: string; organizationId?: string } = {},
) {
  reference += 1;
  return prisma.order.create({
    data: {
      organizationId: options.organizationId ?? ctx.organization.id,
      customerId,
      channel: 'WALK_IN',
      reference: `ORD-TEST-${reference}-${Math.random().toString(36).slice(2, 6)}`,
      status: (options.status ?? 'DELIVERED') as 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'cash',
      currency: 'NGN',
      subtotal: total,
      totalAmount: total,
      placedAt: new Date(Date.now() - (options.daysAgo ?? 0) * 86_400_000),
      lineItems: {
        create: [{ name: 'Ankara fabric', quantity: 1, unitPrice: total, totalPrice: total }],
      },
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: 'Insights Test', slug: `__test-insights-${suffix}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  otherOrgId = (
    await prisma.organization.create({ data: { name: 'Other', slug: `__test-insights-other-${suffix}` } })
  ).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId } } });
    await prisma.order.deleteMany({ where: { organizationId } });
    await prisma.customer.updateMany({ where: { organizationId }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

beforeEach(() => {
  ctx.membership.role.permissions = [PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.CUSTOMER_EDIT];
});

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const rowFor = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id);

describe('customer metrics', () => {
  it('counts settled orders and leaves cancelled ones out of the money', async () => {
    const ada = await customer('Metrics Ada');
    await order(ada.id, 10_000);
    await order(ada.id, 30_000);
    await order(ada.id, 999_999, { status: 'CANCELLED' });

    const list = unwrap(await listCustomerInsights({ q: 'Metrics Ada' }));
    const row = rowFor(list.rows, ada.id)!;
    expect(row.orderCount).toBe(2);
    expect(row.totalSpend).toBe(40_000);
    expect(row.averageOrder).toBe(20_000);

    /* The detail page must agree with the list, to the naira. */
    const detail = unwrap(await getCustomerDetail(ada.id));
    expect(detail.metrics.orderCount).toBe(2);
    expect(detail.metrics.totalSpend).toBe(40_000);
    expect(detail.metrics.averageOrder).toBe(20_000);
  });

  it('shows no return rate for someone who has never ordered', async () => {
    const nobody = await customer('Never Ordered Nkechi');
    const detail = unwrap(await getCustomerDetail(nobody.id));
    // Not 0% — a perfect record nobody earned.
    expect(detail.metrics.returnRatio).toBeNull();
    expect(detail.metrics.orderCount).toBe(0);
  });

  it('ranks what they buy most by money', async () => {
    const chidi = await customer('Top Products Chidi');
    const o = await order(chidi.id, 5_000);
    await prisma.orderLineItem.create({
      data: { orderId: o.id, name: 'Gele', quantity: 3, unitPrice: 1_000, totalPrice: 3_000 },
    });

    const detail = unwrap(await getCustomerDetail(chidi.id));
    expect(detail.topProducts[0].name).toBe('Ankara fabric');
    expect(detail.topProducts.map((p) => p.name)).toContain('Gele');
  });
});

describe('segments', () => {
  it('finds repeat customers, and only them', async () => {
    const once = await customer('Segment Once');
    const twice = await customer('Segment Twice');
    await order(once.id, 1_000);
    await order(twice.id, 1_000);
    await order(twice.id, 2_000);

    const repeat = unwrap(await listCustomerInsights({ segment: 'repeat', q: 'Segment ' }));
    const ids = repeat.rows.map((r) => r.id);
    expect(ids).toContain(twice.id);
    expect(ids).not.toContain(once.id);
  });

  it('finds customers who have gone quiet, but not ones who never came', async () => {
    const lapsed = await customer('Quiet Lapsed');
    const fresh = await customer('Quiet Fresh');
    const never = await customer('Quiet Never');
    await order(lapsed.id, 1_000, { daysAgo: 200 });
    await order(fresh.id, 1_000, { daysAgo: 2 });

    const quiet = unwrap(await listCustomerInsights({ segment: 'inactive', q: 'Quiet ' }));
    const ids = quiet.rows.map((r) => r.id);
    expect(ids).toContain(lapsed.id);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(never.id);
  });

  it('finds people who have never ordered', async () => {
    const never = await customer('Blank Slate');
    const buyer = await customer('Blank Buyer');
    await order(buyer.id, 1_000);

    const rows = unwrap(await listCustomerInsights({ segment: 'never-ordered', q: 'Blank ' })).rows;
    expect(rows.map((r) => r.id)).toEqual([never.id]);
  });

  it('ignores a segment it does not recognise rather than returning nothing', async () => {
    const someone = await customer('Unknown Segment Person');
    const rows = unwrap(await listCustomerInsights({ segment: 'not-a-segment', q: 'Unknown Segment' })).rows;
    expect(rows.map((r) => r.id)).toContain(someone.id);
  });

  it('sorts by spend, and by name, as asked', async () => {
    const small = await customer('Zed Sort Small');
    const big = await customer('Alpha Sort Big');
    await order(small.id, 1_000);
    await order(big.id, 90_000);

    const bySpend = unwrap(await listCustomerInsights({ q: 'Sort ', sort: 'spend' })).rows;
    expect(bySpend[0].id).toBe(big.id);

    const byName = unwrap(await listCustomerInsights({ q: 'Sort ', sort: 'name' })).rows;
    expect(byName[0].id).toBe(big.id); // "Alpha" before "Zed"
  });

  it('never reaches another workspace’s customers', async () => {
    await customer('Foreign Person', {}, otherOrgId);
    const rows = unwrap(await listCustomerInsights({ q: 'Foreign Person' })).rows;
    expect(rows).toEqual([]);
  });

  it('refuses a member without customer.view', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
    expect((await listCustomerInsights()).success).toBe(false);
    expect((await exportCustomerInsights()).success).toBe(false);
  });
});

describe('notes, labels and consent', () => {
  it('keeps notes and de-duplicates labels', async () => {
    const person = await customer('Notes Person');
    unwrap(await updateCustomerNotes(person.id, { notes: '  Prefers WhatsApp  ', tags: ['vip', 'vip', ' wholesale '] }));

    const detail = unwrap(await getCustomerDetail(person.id));
    expect(detail.notes).toBe('Prefers WhatsApp');
    expect(detail.tags).toEqual(['vip', 'wholesale']);
  });

  it('stamps when consent changed', async () => {
    const person = await customer('Consent Person');
    unwrap(await setMarketingConsent(person.id, true));

    const detail = unwrap(await getCustomerDetail(person.id));
    expect(detail.marketingConsent).toBe(true);
    expect(detail.consentUpdatedAt).not.toBeNull();

    const consented = unwrap(await listCustomerInsights({ segment: 'consented', q: 'Consent Person' })).rows;
    expect(consented.map((r) => r.id)).toContain(person.id);
  });

  it('refuses edits from a member with view only', async () => {
    const person = await customer('Read Only Person');
    ctx.membership.role.permissions = [PERMISSIONS.CUSTOMER_VIEW];
    expect((await updateCustomerNotes(person.id, { notes: 'nope' })).success).toBe(false);
    expect((await setMarketingConsent(person.id, true)).success).toBe(false);
  });
});

describe('merging duplicates', () => {
  it('moves everything onto the survivor and counts it together', async () => {
    const walkIn = await customer('Merge Ada', { phone: '08011110000' });
    const online = await customer('Merge Ada Obi', { phone: '08011110000', email: `merge-${Date.now()}@example.com` });
    await order(walkIn.id, 5_000);
    await order(online.id, 15_000);

    unwrap(await mergeCustomers(walkIn.id, online.id));

    const detail = unwrap(await getCustomerDetail(online.id));
    expect(detail.metrics.orderCount).toBe(2);
    expect(detail.metrics.totalSpend).toBe(20_000);
    expect(detail.mergedFrom.map((m) => m.id)).toContain(walkIn.id);

    /* The old record is gone from the list, and can't be opened as a
     * customer any more — it is a signpost now. */
    const rows = unwrap(await listCustomerInsights({ q: 'Merge Ada' })).rows;
    expect(rows.map((r) => r.id)).not.toContain(walkIn.id);
    expect((await getCustomerDetail(walkIn.id)).success).toBe(false);
  });

  it('suggests duplicates by phone, and says why', async () => {
    const a = await customer('Dup One', { phone: '08022220000' });
    const b = await customer('Dup Two', { phone: '08022220000' });

    const candidates = unwrap(await findMergeCandidates(a.id));
    const match = candidates.find((c) => c.id === b.id);
    expect(match?.reason).toBe('phone');
  });

  it('refuses to merge a record into itself, or one already merged', async () => {
    const keep = await customer('Twice Merged Keep');
    const gone = await customer('Twice Merged Gone');
    unwrap(await mergeCustomers(gone.id, keep.id));

    expect((await mergeCustomers(keep.id, keep.id)).success).toBe(false);
    expect((await mergeCustomers(gone.id, keep.id)).success).toBe(false);
  });

  it('refuses to merge across workspaces', async () => {
    const mine = await customer('Mine To Keep');
    const theirs = await customer('Theirs', {}, otherOrgId);
    expect((await mergeCustomers(theirs.id, mine.id)).success).toBe(false);
  });

  it('refuses a member without customer.edit', async () => {
    const a = await customer('Perm Merge A');
    const b = await customer('Perm Merge B');
    ctx.membership.role.permissions = [PERMISSIONS.CUSTOMER_VIEW];
    expect((await mergeCustomers(a.id, b.id)).success).toBe(false);
  });
});

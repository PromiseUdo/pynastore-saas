// Settings → Activity, against the real DB with a mocked org context.
//
// lib/audit-labels.test.ts proves the words. This proves the query: real
// Postgres, real Prisma `where` clauses, the permission gate and the plan
// gate on the download.
//
// What it is here to catch: one store's session reaching another store's
// audit trail, a filter that widens instead of narrows, and the paid export
// being available without the plan.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: {
    id: '',
    name: 'Activity Test',
    slug: '',
    logoUrl: null,
    plan: 'PRO',
    status: 'ACTIVE',
    currency: 'NGN',
  },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  /* AuditLog.userId is a real foreign key, so rows written here leave it
   * null — the same choice tests/settings-bank-accounts.test.ts makes. */
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { listActivity, exportActivity } = await import('@/features/settings/activity');

let otherOrgId = '';

/** An audit row `daysAgo` days old. */
async function log(organizationId: string, action: string, entityType: string, entityId: string, daysAgo = 0) {
  return prisma.auditLog.create({
    data: {
      organizationId,
      action,
      entityType,
      entityId,
      createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const org = await prisma.organization.create({
    data: { name: 'Activity Test', slug: `__test-activity-${suffix}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  otherOrgId = (
    await prisma.organization.create({ data: { name: 'Other', slug: `__test-activity-other-${suffix}` } })
  ).id;

  await log(org.id, 'sales.invoice.voided', 'Invoice', 'inv_1');
  await log(org.id, 'sales.order.refunded', 'Order', 'ord_1', 2);
  await log(org.id, 'inventory.item.created', 'InventoryItem', 'item_1', 5);
  await log(org.id, 'settings.organization.update', 'Organization', org.id, 40);

  /* Deliberately recognisable: the assertions prove it never comes back. */
  await log(otherOrgId, 'sales.invoice.voided', 'Invoice', 'FOREIGN_INVOICE');
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

beforeEach(() => {
  ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
  ctx.organization.plan = 'PRO';
});

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe('listActivity', () => {
  it('returns this store’s rows, newest first, and never another store’s', async () => {
    const data = unwrap(await listActivity());

    expect(data.rows.map((r) => r.entityId)).toEqual(['inv_1', 'ord_1', 'item_1', ctx.organization.id]);
    expect(data.rows.some((r) => r.entityId === 'FOREIGN_INVOICE')).toBe(false);
    expect(data.total).toBe(4);
    expect(data.historySize).toBe(4);
  });

  it('refuses a member without settings.view', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
    const result = await listActivity();
    expect(result.success).toBe(false);
  });

  it('narrows to one area, matching the prefix and not a partial word', async () => {
    const sales = unwrap(await listActivity({ area: 'sales' }));
    expect(sales.rows.map((r) => r.entityId)).toEqual(['inv_1', 'ord_1']);
    // historySize ignores filters, so the page can tell "none yet" from "none match".
    expect(sales.historySize).toBe(4);
  });

  it('ignores an area it does not recognise rather than returning nothing', async () => {
    const data = unwrap(await listActivity({ area: 'sale' }));
    expect(data.total).toBe(4);
  });

  it('narrows by date range', async () => {
    const data = unwrap(await listActivity({ from: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }));
    expect(data.rows.map((r) => r.entityId)).toEqual(['inv_1', 'ord_1']);
  });

  it('searches by record id', async () => {
    const data = unwrap(await listActivity({ q: 'item_1' }));
    expect(data.rows.map((r) => r.entityId)).toEqual(['item_1']);
  });

  it('cannot be made to return another store’s row by searching for it', async () => {
    const data = unwrap(await listActivity({ q: 'FOREIGN_INVOICE' }));
    expect(data.rows).toEqual([]);
  });

  it('lists the members who can be filtered on', async () => {
    const data = unwrap(await listActivity());
    expect(Array.isArray(data.members)).toBe(true);
  });
});

describe('exportActivity', () => {
  it('gives every matching row, not just the page on screen', async () => {
    const rows = unwrap(await exportActivity({ area: 'sales' }));
    expect(rows.map((r) => r.entityId)).toEqual(['inv_1', 'ord_1']);
  });

  it('is refused without the plan that sells it', async () => {
    ctx.organization.plan = 'FREE';
    const result = await exportActivity();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/Pro plan/);
  });

  it('is refused without settings.view, whatever the plan', async () => {
    ctx.membership.role.permissions = [];
    const result = await exportActivity();
    expect(result.success).toBe(false);
  });
});

// Merchant bank accounts (Settings → Payments), against the real DB with a mocked org context.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Bank Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

// The bank's answer, by account number. Anything else is "no such account".
const lookup = vi.hoisted(() => ({
  names: { '0123456789': 'BANK TEST LTD' } as Record<string, string>,
  down: false,
}));
vi.mock('@/lib/payments/squad', () => ({
  lookupAccountName: async (_bankCode: string, accountNumber: string) => {
    if (lookup.down) throw new Error('network');
    return lookup.names[accountNumber] ?? null;
  },
}));

const { listBankAccounts, lookupBankAccountName, saveBankAccount, setBankAccountActive, deleteBankAccount } = await import(
  '@/features/settings/bank-accounts'
);
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');

let otherOrgId = '';
let foreignAccountId = '';

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Bank Test', slug: `__test-bank-${suffix}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];

  otherOrgId = (await prisma.organization.create({ data: { name: 'Other', slug: `__test-bank-other-${suffix}` } })).id;
  foreignAccountId = (
    await prisma.merchantBankAccount.create({
      data: { organizationId: otherOrgId, bankName: 'Other Bank', accountName: 'Other', accountNumber: '5555555555' },
    })
  ).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.merchantBankAccount.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('bank accounts', () => {
  it('validates each field and says which one is wrong', async () => {
    const result = await saveBankAccount(null, { bankCode: '999999', accountNumber: '12345' });
    expect(result.success).toBe(false);
    expect(result.success === false && 'fieldErrors' in result && result.fieldErrors).toEqual({
      bankCode: 'Choose your bank',
      accountNumber: 'Account numbers are 10 digits',
    });
  });

  it('looks up the name on an account, and says when the bank doesn’t know it', async () => {
    expect(await lookupBankAccountName({ bankCode: '000013', accountNumber: '012 345 6789' })).toEqual({
      success: true,
      data: { accountName: 'BANK TEST LTD' },
    });
    expect(await lookupBankAccountName({ bankCode: '000013', accountNumber: '9999999999' })).toMatchObject({
      success: false,
      fieldErrors: { accountNumber: expect.stringMatching(/couldn’t find/) },
    });
  });

  it('says the bank is unreachable rather than that the account is wrong', async () => {
    lookup.down = true;
    try {
      const result = await lookupBankAccountName({ bankCode: '000013', accountNumber: '0123456789' });
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/couldn’t reach/) });
      expect('fieldErrors' in result).toBe(false);
    } finally {
      lookup.down = false;
    }
  });

  it('won’t save an account the bank doesn’t recognise', async () => {
    expect(await saveBankAccount(null, { bankCode: '000013', accountNumber: '9999999999' })).toMatchObject({
      success: false,
    });
    expect(await prisma.merchantBankAccount.count({ where: { organizationId: ctx.organization.id } })).toBe(0);
  });

  it('adds an account, which switches bank transfer on at checkout', async () => {
    const before = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
    expect(before.paymentMethods.map((m) => m.id)).not.toContain('transfer');

    // The name is the bank's, never the browser's.
    const saved = await saveBankAccount(null, {
      bankCode: '000013',
      accountNumber: '012 345 6789',
      accountName: 'Somebody Else',
    } as never);
    expect(saved.success).toBe(true);

    const list = await listBankAccounts();
    expect(list.success && list.data).toEqual([
      expect.objectContaining({
        bankName: 'GTBank',
        accountName: 'BANK TEST LTD',
        accountNumber: '0123456789',
        isActive: true,
      }),
    ]);

    const after = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
    expect(after.paymentMethods.at(-1)?.id).toBe('transfer');
  });

  it('hides an inactive account from checkout', async () => {
    const list = await listBankAccounts();
    const id = list.success ? list.data[0].id : '';
    expect((await setBankAccountActive(id, false)).success).toBe(true);
    const config = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
    expect(config.paymentMethods.map((m) => m.id)).not.toContain('transfer');
    await setBankAccountActive(id, true);
  });

  it('never lists, edits or removes another store’s account', async () => {
    const list = await listBankAccounts();
    expect(list.success && list.data.map((a) => a.accountNumber)).not.toContain('5555555555');

    expect(
      await saveBankAccount(foreignAccountId, { bankCode: '000013', accountNumber: '0123456789' }),
    ).toMatchObject({ success: false });
    expect(await setBankAccountActive(foreignAccountId, false)).toMatchObject({ success: false });
    expect(await deleteBankAccount(foreignAccountId)).toMatchObject({ success: false });

    const untouched = await prisma.merchantBankAccount.findUniqueOrThrow({ where: { id: foreignAccountId } });
    expect(untouched).toMatchObject({ bankName: 'Other Bank', isActive: true });
  });

  it('lets someone who can only view see accounts but not change them', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    try {
      expect((await listBankAccounts()).success).toBe(true);
      expect(
        await saveBankAccount(null, { bankCode: '000014', accountNumber: '0123456789' }),
      ).toMatchObject({ success: false, error: expect.stringMatching(/permission/i) });
    } finally {
      ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];
    }
  });

  it('removes an account', async () => {
    const list = await listBankAccounts();
    const id = list.success ? list.data[0].id : '';
    expect((await deleteBankAccount(id)).success).toBe(true);
    const after = await listBankAccounts();
    expect(after.success && after.data).toEqual([]);
  });
});

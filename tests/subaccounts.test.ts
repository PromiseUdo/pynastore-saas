// A merchant's Paystack subaccount (ROADMAP 10.3), against the real DB with a
// scripted Paystack.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

type Sub = { code: string; active: boolean; isVerified: boolean; accountName: string | null; metadata: Record<string, unknown> | null };

const paystack = vi.hoisted(() => ({
  subs: new Map<string, { active: boolean; isVerified: boolean; metadata: Record<string, unknown> }>(),
  creates: [] as Record<string, unknown>[],
  fetches: 0,
  /** what the next createSubaccount does */
  next: 'ok' as 'ok' | 'refuse' | 'timeout' | 'timeout-after-creating',
  /** the mode the server's key is in (13.9) */
  mode: 'test' as 'test' | 'live',
  delayMs: 0,
}));

vi.mock('@/lib/payments/paystack', () => {
  class PaystackError extends Error {
    constructor(
      message: string,
      readonly httpStatus: number,
    ) {
      super(message);
      this.name = 'PaystackError';
    }
  }
  const toSub = (code: string): Sub => {
    const s = paystack.subs.get(code)!;
    return { code, active: s.active, isVerified: s.isVerified, accountName: 'TEST', metadata: s.metadata };
  };
  return {
    PaystackError,
    isPaystackConfigured: () => true,
    paystackKeyMode: () => paystack.mode,
    createSubaccount: async (input: { metadata: Record<string, string> } & Record<string, unknown>) => {
      if (paystack.delayMs) await new Promise((r) => setTimeout(r, paystack.delayMs));
      paystack.creates.push(input);
      const mode = paystack.next;
      paystack.next = 'ok';
      if (mode === 'refuse') throw new PaystackError('Account details are invalid', 400);
      const code = `ACCT_${paystack.creates.length}_${Math.random().toString(36).slice(2, 7)}`;
      if (mode === 'timeout') throw new Error('The operation was aborted due to timeout');
      paystack.subs.set(code, { active: true, isVerified: false, metadata: input.metadata });
      if (mode === 'timeout-after-creating') throw new Error('The operation was aborted due to timeout');
      return toSub(code);
    },
    fetchSubaccount: async (code: string) => {
      paystack.fetches++;
      return paystack.subs.has(code) ? toSub(code) : null;
    },
    findSubaccountsByMetadata: async (key: string, value: string) =>
      [...paystack.subs.keys()].filter((c) => paystack.subs.get(c)!.metadata[key] === value).map(toSub),
  };
});

const { provisionSubaccount, syncSubaccount } = await import('@/lib/payments/subaccounts');
const { getOnlinePaymentReadiness } = await import('@/lib/payments/online-readiness');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const created: string[] = [];

async function verifiedMerchant(name: string, overrides: Record<string, unknown> = {}) {
  const org = await prisma.organization.create({ data: { name, slug: `__test-subacct-${name.toLowerCase()}-${suffix}` } });
  created.push(org.id);
  await prisma.merchantPaymentAccount.create({
    data: {
      organizationId: org.id,
      businessType: 'INDIVIDUAL',
      businessName: `${name} Store`,
      settlementBankCode: '057',
      settlementBankName: 'Zenith Bank',
      settlementAccountNumber: '0000000000',
      settlementAccountName: 'TEST',
      contactName: name,
      contactEmail: `${name.toLowerCase()}@example.com`,
      verificationStatus: 'VERIFIED',
      setupStatus: 'AWAITING_VERIFICATION',
      ...overrides,
    },
  });
  return org.id;
}

const account = (organizationId: string) => prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId } });

beforeEach(() => {
  paystack.next = 'ok';
  paystack.delayMs = 0;
});

afterAll(async () => {
  for (const organizationId of created) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('creating the subaccount', () => {
  it('does nothing for a business we haven’t verified', async () => {
    const orgId = await verifiedMerchant('Pending', { verificationStatus: 'PENDING' });
    const before = paystack.creates.length;
    expect(await provisionSubaccount(orgId, null)).toEqual({ outcome: 'not-eligible' });
    expect(paystack.creates.length).toBe(before);
    expect((await account(orgId)).paystackSubaccountCode).toBeNull();
  });

  it('creates it once, with a zero platform share and the org in its metadata, and payments become possible', async () => {
    const orgId = await verifiedMerchant('Once');
    const result = await provisionSubaccount(orgId, null);
    expect(result).toMatchObject({ outcome: 'created', code: expect.stringMatching(/^ACCT_/) });
    expect(paystack.creates.at(-1)).toMatchObject({
      businessName: 'Once Store',
      bankCode: '057',
      accountNumber: '0000000000',
      metadata: { organizationId: orgId, platform: 'mansaas' },
    });
    expect(await account(orgId)).toMatchObject({
      setupStatus: 'ACTIVE',
      paystackSubaccountCode: result.outcome === 'created' ? result.code : '',
      paystackIsVerified: false,
      setupError: null,
    });
    expect(await getOnlinePaymentReadiness(orgId)).toEqual({ ready: true, blocker: null });

    // Again: nothing new is created.
    const count = paystack.creates.length;
    expect((await provisionSubaccount(orgId, null)).outcome).toBe('already-set-up');
    expect(paystack.creates.length).toBe(count);
  });

  it('creates one when two approvals race', async () => {
    const orgId = await verifiedMerchant('Race');
    paystack.delayMs = 150;
    const before = paystack.creates.length;
    const outcomes = await Promise.all([provisionSubaccount(orgId, null), provisionSubaccount(orgId, null)]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['busy', 'created']);
    expect(paystack.creates.length - before).toBe(1);
  });

  it('records a refusal as needing attention, in words, and payments stay off', async () => {
    const orgId = await verifiedMerchant('Refused');
    paystack.next = 'refuse';
    expect(await provisionSubaccount(orgId, null)).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/refused/) });
    expect(await account(orgId)).toMatchObject({
      setupStatus: 'ACTION_REQUIRED',
      paystackSubaccountCode: null,
      setupError: expect.stringMatching(/Account details are invalid/),
    });
    expect(await getOnlinePaymentReadiness(orgId)).toEqual({ ready: false, blocker: 'payouts_not_ready' });
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: 'platform.payouts.subaccount_failed' } });
    expect(audit).not.toBeNull();

    // A retry with nothing on Paystack creates it.
    expect((await provisionSubaccount(orgId, null)).outcome).toBe('created');
  });

  it('after a timeout that DID create one, the retry finds and adopts it rather than making a second', async () => {
    const orgId = await verifiedMerchant('Lost');
    paystack.next = 'timeout-after-creating';
    expect(await provisionSubaccount(orgId, null)).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/don’t know/) });
    const onPaystack = [...paystack.subs.entries()].filter(([, s]) => s.metadata.organizationId === orgId);
    expect(onPaystack).toHaveLength(1);

    const creates = paystack.creates.length;
    const retry = await provisionSubaccount(orgId, null);
    expect(retry).toEqual({ outcome: 'adopted', code: onPaystack[0][0] });
    expect(paystack.creates.length).toBe(creates);
    expect(await account(orgId)).toMatchObject({ setupStatus: 'ACTIVE', paystackSubaccountCode: onPaystack[0][0] });
  });

  it('takes over a claim that died mid-request, but not a fresh one', async () => {
    const orgId = await verifiedMerchant('Stuck', { setupStatus: 'CREATING' });
    expect((await provisionSubaccount(orgId, null)).outcome).toBe('busy');
    await prisma.$executeRaw`UPDATE merchant_payment_accounts SET "updatedAt" = now() - interval '10 minutes' WHERE "organizationId" = ${orgId}`;
    expect((await provisionSubaccount(orgId, null)).outcome).toBe('created');
  });

  it('refuses when there’s no settlement account to give Paystack', async () => {
    const orgId = await verifiedMerchant('Empty', { settlementAccountNumber: null, settlementAccountName: null });
    expect(await provisionSubaccount(orgId, null)).toMatchObject({ outcome: 'failed' });
    expect((await account(orgId)).setupStatus).toBe('ACTION_REQUIRED');
  });
});

describe('keeping our copy in line with Paystack', () => {
  it('turns payments off when Paystack switches the subaccount off, and back on when it’s switched on', async () => {
    const orgId = await verifiedMerchant('Synced');
    const result = await provisionSubaccount(orgId, null);
    const code = result.outcome === 'created' ? result.code : '';

    // Fresh copy: not re-read unless forced.
    const fetches = paystack.fetches;
    await syncSubaccount(orgId);
    expect(paystack.fetches).toBe(fetches);

    paystack.subs.get(code)!.active = false;
    await syncSubaccount(orgId, { force: true });
    expect(await account(orgId)).toMatchObject({ setupStatus: 'DISABLED', setupError: expect.stringMatching(/switched off/) });
    expect(await getOnlinePaymentReadiness(orgId)).toMatchObject({ ready: false, blocker: 'payouts_not_ready' });

    paystack.subs.get(code)!.active = true;
    paystack.subs.get(code)!.isVerified = true;
    await syncSubaccount(orgId, { force: true });
    expect(await account(orgId)).toMatchObject({ setupStatus: 'ACTIVE', setupError: null, paystackIsVerified: true });

    paystack.subs.delete(code);
    await syncSubaccount(orgId, { force: true });
    expect(await account(orgId)).toMatchObject({ setupStatus: 'DISABLED', setupError: expect.stringMatching(/no longer knows/) });
  });
});

describe('going live (13.9)', () => {
  it('never uses a test-mode subaccount once the key is live, and replaces it with a live one', async () => {
    paystack.mode = 'test';
    const orgId = await verifiedMerchant('GoingLive');
    const first = await provisionSubaccount(orgId, null);
    const testCode = first.outcome === 'created' ? first.code : '';
    expect(await account(orgId)).toMatchObject({ paystackSubaccountCode: testCode, paystackSubaccountMode: 'test', setupStatus: 'ACTIVE' });
    expect((await getOnlinePaymentReadiness(orgId)).ready).toBe(true);

    // The live key goes in. The test subaccount doesn't exist for it.
    paystack.mode = 'live';
    try {
      expect(await getOnlinePaymentReadiness(orgId)).toMatchObject({ ready: false, blocker: 'payouts_not_ready' });
      const fetches = paystack.fetches;
      await syncSubaccount(orgId, { force: true });
      expect(paystack.fetches).toBe(fetches); // not asked about with the wrong key
      expect((await account(orgId)).setupStatus).toBe('ACTIVE'); // …so not wrongly switched off either

      const moved = await provisionSubaccount(orgId, null);
      expect(moved.outcome).toBe('created');
      const liveCode = moved.outcome === 'created' ? moved.code : '';
      expect(liveCode).not.toBe(testCode);
      expect(await account(orgId)).toMatchObject({ paystackSubaccountCode: liveCode, paystackSubaccountMode: 'live', setupStatus: 'ACTIVE' });
      expect((await getOnlinePaymentReadiness(orgId)).ready).toBe(true);
      expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: 'platform.payouts.subaccount_replaced' } })).toBe(1);

      // Asking again changes nothing.
      expect((await provisionSubaccount(orgId, null)).outcome).toBe('already-set-up');
    } finally {
      paystack.mode = 'test';
    }
  });

  it('treats a subaccount recorded before modes were tracked as a test one', async () => {
    const orgId = await verifiedMerchant('Legacy', { paystackSubaccountCode: `ACCT_legacy_${suffix}`, setupStatus: 'ACTIVE' });
    expect((await getOnlinePaymentReadiness(orgId)).ready).toBe(true);
    paystack.mode = 'live';
    try {
      expect((await getOnlinePaymentReadiness(orgId)).ready).toBe(false);
    } finally {
      paystack.mode = 'test';
    }
  });
});

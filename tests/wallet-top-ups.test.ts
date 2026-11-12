/*
 * Wallet top-ups (ROADMAP 20.3) against the real database, with EduPay
 * faked. What must hold: a top-up is recorded with EduPay's own charges; it
 * is COMPLETED only on EduPay's word; one shopper's top-up id is nothing to
 * another; "adding…" shows only for payments the payer said they made; and
 * the job settles the ones nobody waited for, and lets unpaid ones lapse.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wallet/edupay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wallet/edupay')>()),
  edupayConfigured: () => true,
  walletEnvironment: () => 'test',
  initiateFunding: vi.fn(),
  fundingState: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { fundingState, initiateFunding } from '@/lib/wallet/edupay';
import { checkTopUp, parseTopUpAmount, pendingTopUps, settlePendingTopUps, startTopUp, type TopUpOwner } from '@/lib/wallet/top-up';

const initiate = vi.mocked(initiateFunding);
const state = vi.mocked(fundingState);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '' };
let ada: TopUpOwner;
let tunde: TopUpOwner;
let n = 0;

async function shopperWithWallet(name: string) {
  n += 1;
  const customer = await prisma.customer.create({
    data: { organizationId: store.id, name, email: `${name.toLowerCase()}-${n}-${suffix}@example.com`, phone: '+2348031234567', emailVerifiedAt: new Date() },
  });
  await prisma.shopperWallet.create({
    data: { organizationId: store.id, customerId: customer.id, userRef: `shopper-${customer.id}`, status: 'ACTIVE', edupayUuid: `u-${n}`, edupayUniqId: `Q${n}`, environment: 'test' },
  });
  return { kind: 'SHOPPER' as const, organizationId: store.id, customerId: customer.id };
}

let ref = 0;
function started(amount = 1500) {
  ref += 1;
  return {
    kind: 'started' as const,
    reference: `TXREF_${suffix}_${ref}`,
    accessCode: `code-${ref}`,
    amount,
    fee: 122.5,
    total: amount + 122.5,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  };
}

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Top-up Store', slug: `__test-topups-${suffix}` } })).id;
  ada = await shopperWithWallet('Ada');
  tunde = await shopperWithWallet('Tunde');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(async () => {
  await prisma.walletTopUp.deleteMany({ where: { organizationId: store.id } });
  await prisma.shopperWallet.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.delete({ where: { id: store.id } });
});

beforeEach(() => {
  initiate.mockReset();
  state.mockReset();
});

describe('parseTopUpAmount', () => {
  it('takes whole naira, with or without commas, within the limits', () => {
    expect(parseTopUpAmount('5,000')).toBe(5000);
    expect(parseTopUpAmount('₦ 1500')).toBe(1500);
    expect(parseTopUpAmount('99')).toBeNull();
    expect(parseTopUpAmount('1500.50')).toBeNull();
    expect(parseTopUpAmount('2000000')).toBeNull();
    expect(parseTopUpAmount('abc')).toBeNull();
  });
});

describe('starting a top-up', () => {
  it('records EduPay’s charges and hands back the access code', async () => {
    initiate.mockResolvedValueOnce(started(1500));
    const result = await startTopUp(ada, 1500);

    expect(result).toMatchObject({ ok: true, accessCode: expect.stringMatching(/^code-/), amount: 1500, fee: 122.5, total: 1622.5 });
    if (!result.ok) return;
    const row = await prisma.walletTopUp.findUniqueOrThrow({ where: { id: result.topUpId } });
    expect(row).toMatchObject({ kind: 'SHOPPER', customerId: (ada as { customerId: string }).customerId, status: 'PENDING', environment: 'test' });
    expect(Number(row.amount)).toBe(1500);
    expect(Number(row.total)).toBe(1622.5);
  });

  it('starts nothing for a wallet that isn’t active', async () => {
    const result = await startTopUp({ kind: 'SHOP', organizationId: store.id, startedById: 'staff-1' }, 1500);
    expect(result).toEqual({ ok: false, reason: 'no-wallet' });
    expect(initiate).not.toHaveBeenCalled();
  });
});

describe('has it landed?', () => {
  it('is completed only when EduPay says so — and records it once', async () => {
    initiate.mockResolvedValueOnce(started());
    const result = await startTopUp(ada, 1500);
    if (!result.ok) throw new Error('not started');

    state.mockResolvedValueOnce('unknown');
    await expect(checkTopUp(ada, result.topUpId, { reportedPaid: true })).resolves.toEqual({ status: 'PENDING', amount: 1500 });

    state.mockResolvedValueOnce('completed');
    await expect(checkTopUp(ada, result.topUpId, { reportedPaid: true })).resolves.toEqual({ status: 'COMPLETED', amount: 1500 });

    // Settled: no more questions to EduPay.
    await expect(checkTopUp(ada, result.topUpId)).resolves.toEqual({ status: 'COMPLETED', amount: 1500 });
    expect(state).toHaveBeenCalledTimes(2);
  });

  it('is nothing to another shopper', async () => {
    initiate.mockResolvedValueOnce(started());
    const result = await startTopUp(ada, 1500);
    if (!result.ok) throw new Error('not started');
    await expect(checkTopUp(tunde, result.topUpId)).resolves.toBeNull();
    expect(state).not.toHaveBeenCalled();
  });

  it('shows "adding…" only for payments the payer said they made', async () => {
    initiate.mockResolvedValueOnce(started(2000)).mockResolvedValueOnce(started(3000));
    const closed = await startTopUp(tunde, 2000);
    const paid = await startTopUp(tunde, 3000);
    if (!closed.ok || !paid.ok) throw new Error('not started');

    state.mockResolvedValue('unknown');
    await checkTopUp(tunde, paid.topUpId, { reportedPaid: true });

    const shown = await pendingTopUps(tunde);
    expect(shown.map((t) => t.id)).toEqual([paid.topUpId]);
  });
});

describe('the job', () => {
  it('settles a paid top-up nobody waited for, and lets an unpaid one lapse', async () => {
    initiate.mockResolvedValueOnce(started(4000)).mockResolvedValueOnce({ ...started(5000), expiresAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() });
    const left = await startTopUp(ada, 4000);
    const unpaid = await startTopUp(ada, 5000);
    if (!left.ok || !unpaid.ok) throw new Error('not started');

    state.mockImplementation(async (_ids, reference) => {
      const row = await prisma.walletTopUp.findUniqueOrThrow({ where: { reference } });
      return row.id === left.topUpId ? 'completed' : 'unknown';
    });
    const counts = await settlePendingTopUps({ now: new Date(Date.now() + 2 * 60_000) });

    expect(counts.completed).toBeGreaterThanOrEqual(1);
    await expect(prisma.walletTopUp.findUniqueOrThrow({ where: { id: left.topUpId } })).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(prisma.walletTopUp.findUniqueOrThrow({ where: { id: unpaid.topUpId } })).resolves.toMatchObject({ status: 'EXPIRED' });
  });

  it('never calls a payment the payer was told succeeded "expired" — it waits, flagged for staff', async () => {
    initiate.mockResolvedValueOnce({ ...started(7000), expiresAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() });
    const result = await startTopUp(ada, 7000);
    if (!result.ok) throw new Error('not started');

    state.mockResolvedValue('unknown');
    await checkTopUp(ada, result.topUpId, { reportedPaid: true });
    await settlePendingTopUps({ now: new Date(Date.now() + 10 * 60_000) });

    const row = await prisma.walletTopUp.findUniqueOrThrow({ where: { id: result.topUpId } });
    expect(row.status).toBe('PENDING');
    expect(row.lastError).toContain('check with EduPay');
  });

  it('never expires one while EduPay can’t be asked', async () => {
    initiate.mockResolvedValueOnce({ ...started(6000), expiresAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() });
    const result = await startTopUp(tunde, 6000);
    if (!result.ok) throw new Error('not started');

    state.mockResolvedValue('unavailable');
    await settlePendingTopUps({ now: new Date(Date.now() + 2 * 60_000) });
    await expect(prisma.walletTopUp.findUniqueOrThrow({ where: { id: result.topUpId } })).resolves.toMatchObject({ status: 'PENDING' });
  });
});

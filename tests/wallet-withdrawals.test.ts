/*
 * Withdrawing from the shop wallet to the shop's bank (ROADMAP 20.7), against
 * the real database, with EduPay faked. What must hold: money only ever goes
 * to the verified settlement account; a withdrawal by hand is refused while
 * auto-withdraw is on, or while EduPay can't say; only the Owner may act; a
 * withdrawal is confirmed at most once, and an unclear answer is settled from
 * the wallet's transactions, never repeated; and money that comes back is
 * recorded and the Owner told. The emailed code is never kept.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wallet/edupay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wallet/edupay')>()),
  edupayConfigured: () => true,
  walletEnvironment: () => 'test',
  getWallet: vi.fn(),
  getBankAccounts: vi.fn(),
  getAutoWithdraw: vi.fn(),
  getAutoWithdrawHistory: vi.fn(async () => []),
  updateAutoWithdraw: vi.fn(),
  requestAddBankAccount: vi.fn(),
  confirmAddBankAccount: vi.fn(),
  requestWithdraw: vi.fn(),
  confirmWithdraw: vi.fn(),
  withdrawalState: vi.fn(),
}));
vi.mock('@/lib/notifications/owner-notices', () => ({ listOwnerNotice: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn(async () => {}) }));
const session = vi.hoisted(() => ({ roleName: 'Owner', organizationId: '', signInMethod: 'two-factor' as string | null }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-1' }, signInMethod: session.signInMethod })) }));
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: vi.fn(async () => ({
    userId: 'user-1',
    organization: { id: session.organizationId },
    membership: { role: { name: session.roleName, isSystem: true, permissions: [] } },
  })),
}));

import { prisma } from '@/lib/prisma';
import {
  confirmAddBankAccount,
  confirmWithdraw,
  getAutoWithdraw,
  getBankAccounts,
  getWallet,
  requestAddBankAccount,
  requestWithdraw,
  updateAutoWithdraw,
  withdrawalState,
  type AutoWithdrawSettings,
} from '@/lib/wallet/edupay';
import { listOwnerNotice } from '@/lib/notifications/owner-notices';
import { cancelWithdrawal, confirmBankLink, confirmWithdrawal, parseWithdrawalAmount, payoutView, saveAutoWithdraw, settleWithdrawals, startBankLink, startWithdrawal } from '@/lib/wallet/payouts';
import { confirmWithdrawalAction, saveAutoWithdrawAction, startWithdrawalAction } from '@/features/settings/shop-wallet-payouts';

const accounts = vi.mocked(getBankAccounts);
const auto = vi.mocked(getAutoWithdraw);
const balance = vi.mocked(getWallet);
const ask = vi.mocked(requestWithdraw);
const confirm = vi.mocked(confirmWithdraw);
const state = vi.mocked(withdrawalState);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shops: string[] = [];
const OFF: AutoWithdrawSettings = { enabled: false, frequency: 'daily', time: '06:05:00', dayOfWeek: null, dayOfMonth: null, minAmount: 100, maxAmount: null, reserve: 0, bankAccountId: null, notifyOnRun: true };
const VERIFIED = { id: 7, accountNumber: '0123456789', bankCode: '058', active: true };

async function shop({ verified = true } = {}) {
  const org = await prisma.organization.create({ data: { name: 'Payout Store', slug: `__test-payout-${shops.length}-${suffix}` } });
  shops.push(org.id);
  await prisma.merchantPaymentAccount.create({
    data: {
      organizationId: org.id,
      businessName: 'Payout Store',
      contactEmail: 'ada@example.com',
      verificationStatus: verified ? 'VERIFIED' : 'PENDING',
      settlementBankCode: '058',
      settlementBankName: 'GTBank',
      settlementAccountNumber: '0123456789',
      settlementAccountName: 'PAYOUT STORE LTD',
    },
  });
  await prisma.shopWallet.create({
    data: { organizationId: org.id, userRef: `shop-${org.id}`, status: 'ACTIVE', edupayUuid: `u-${org.id}`, edupayUniqId: 'Q', environment: 'test' },
  });
  return org.id;
}

const by = (organizationId: string) => ({ organizationId, performedById: 'user-1' });
const rows = (organizationId: string) => prisma.walletWithdrawal.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });

/** A withdrawal waiting for its code. */
async function waiting(organizationId: string, rawAmount = '5,000') {
  ask.mockResolvedValueOnce({ kind: 'code-sent' });
  const started = await startWithdrawal({ ...by(organizationId), rawAmount });
  if (!started.ok) throw new Error(started.error);
  return started.data;
}

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  await prisma.walletWithdrawal.deleteMany({ where: { organizationId: { in: shops } } });
  await prisma.shopWallet.deleteMany({ where: { organizationId: { in: shops } } });
  await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId: { in: shops } } });
  await prisma.organization.deleteMany({ where: { id: { in: shops } } });
});

beforeEach(() => {
  vi.clearAllMocks();
  session.roleName = 'Owner';
  session.signInMethod = 'two-factor';
  accounts.mockReset().mockResolvedValue([VERIFIED]);
  auto.mockReset().mockResolvedValue(OFF);
  balance.mockReset().mockResolvedValue({ balanceKobo: 1_000_000_00, currency: 'NGN', status: 'active', hasPin: true });
  ask.mockReset();
  confirm.mockReset();
  state.mockReset().mockResolvedValue('not-found');
});

describe('parseWithdrawalAmount', () => {
  it('takes whole naira from ₦100', () => {
    expect(parseWithdrawalAmount('5,000')).toBe(5000);
    expect(parseWithdrawalAmount('₦ 100')).toBe(100);
    expect(parseWithdrawalAmount('99')).toBeNull();
    expect(parseWithdrawalAmount('100.50')).toBeNull();
    expect(parseWithdrawalAmount('abc')).toBeNull();
  });
});

describe('the bank account', () => {
  it('connects only the verified settlement account, from our record', async () => {
    const id = await shop();
    accounts.mockResolvedValue([]);
    vi.mocked(requestAddBankAccount).mockResolvedValueOnce({ kind: 'code-sent' });
    await expect(startBankLink(id)).resolves.toEqual({ ok: true, data: undefined });
    expect(requestAddBankAccount).toHaveBeenCalledWith(expect.anything(), { accountNumber: '0123456789', bankCode: '058', bankName: 'GTBank' });

    vi.mocked(confirmAddBankAccount).mockResolvedValueOnce({ kind: 'wrong-code' });
    await expect(confirmBankLink(id, '111111')).resolves.toMatchObject({ ok: false, field: 'code' });
    vi.mocked(confirmAddBankAccount).mockResolvedValueOnce({ kind: 'done', reference: null });
    await expect(confirmBankLink(id, '222222')).resolves.toEqual({ ok: true, data: undefined });
  });

  it('doesn’t count another account of the wallet’s as the verified one', async () => {
    const id = await shop();
    accounts.mockResolvedValue([{ id: 9, accountNumber: '5555555555', bankCode: '058', active: true }]);
    await expect(payoutView(id)).resolves.toMatchObject({ linked: false, reachable: true });
    await expect(startWithdrawal({ ...by(id), rawAmount: '5000' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Connect your bank account/) });
    expect(ask).not.toHaveBeenCalled();
  });

  it('offers nothing to a shop without a verified account', async () => {
    const id = await shop({ verified: false });
    await expect(startBankLink(id)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/verified/) });
    await expect(startWithdrawal({ ...by(id), rawAmount: '5000' })).resolves.toMatchObject({ ok: false });
    expect(requestAddBankAccount).not.toHaveBeenCalled();
  });
});

describe('withdrawing by hand', () => {
  it('asks EduPay to the verified account, then confirms with the code — keeping no code', async () => {
    const id = await shop();
    await expect(waiting(id)).resolves.toMatchObject({ amount: 5000 });
    const [row] = await rows(id);
    expect(row).toMatchObject({ status: 'AWAITING_CODE', bankName: 'GTBank', accountNumber: '0123456789' });
    expect(ask).toHaveBeenCalledWith(expect.anything(), { amount: 5000, accountId: 7, description: expect.stringContaining(row.reference) });

    confirm.mockResolvedValueOnce({ kind: 'done', reference: 'TXN-W' });
    await expect(confirmWithdrawal({ ...by(id), code: '864209' })).resolves.toEqual({ ok: true, data: 'sent' });
    const [sent] = await rows(id);
    expect(sent).toMatchObject({ status: 'SENT', gatewayRef: 'TXN-W' });
    expect(JSON.stringify(sent)).not.toContain('864209');
  });

  it('is refused while auto-withdraw is on, and while EduPay can’t say', async () => {
    const id = await shop();
    auto.mockResolvedValue({ ...OFF, enabled: true, bankAccountId: 7 });
    await expect(startWithdrawal({ ...by(id), rawAmount: '5000' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Auto-withdraw is on/) });

    auto.mockResolvedValue(null);
    await expect(startWithdrawal({ ...by(id), rawAmount: '5000' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/couldn’t reach EduPay/) });
    expect(ask).not.toHaveBeenCalled();
  });

  it('cancels one waiting for its code if auto-withdraw has come on since', async () => {
    const id = await shop();
    await waiting(id);
    auto.mockResolvedValue({ ...OFF, enabled: true, bankAccountId: 7 });
    await expect(confirmWithdrawal({ ...by(id), code: '123456' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) });
    expect(confirm).not.toHaveBeenCalled();
    expect((await rows(id))[0].status).toBe('EXPIRED');
  });

  it('says the wallet is short before asking for a code', async () => {
    const id = await shop();
    balance.mockResolvedValue({ balanceKobo: 100, currency: 'NGN', status: 'active', hasPin: true });
    await expect(startWithdrawal({ ...by(id), rawAmount: '5000' })).resolves.toMatchObject({ ok: false, field: 'amount' });
    expect(ask).not.toHaveBeenCalled();
    expect(await rows(id)).toHaveLength(0);
  });

  it('records EduPay’s refusals as nothing moved', async () => {
    const id = await shop();
    ask.mockResolvedValueOnce({ kind: 'refused', reason: 'code-not-sent', message: 'Failed to send OTP' });
    await expect(startWithdrawal({ ...by(id), rawAmount: '5000' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/couldn’t send the code/) });
    expect(await rows(id)).toMatchObject([{ status: 'FAILED', lastError: 'Failed to send OTP' }]);
  });

  it('keeps it open on a wrong code, and lets them try again', async () => {
    const id = await shop();
    await waiting(id);
    confirm.mockResolvedValueOnce({ kind: 'wrong-code' });
    await expect(confirmWithdrawal({ ...by(id), code: '000000' })).resolves.toMatchObject({ ok: false, field: 'code' });
    expect((await rows(id))[0].status).toBe('AWAITING_CODE');
    confirm.mockResolvedValueOnce({ kind: 'done', reference: null });
    await expect(confirmWithdrawal({ ...by(id), code: '123456' })).resolves.toEqual({ ok: true, data: 'sent' });
  });

  it('allows one open at a time, and can be cancelled', async () => {
    const id = await shop();
    await waiting(id);
    await expect(startWithdrawal({ ...by(id), rawAmount: '100' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/already in progress/) });
    expect(ask).toHaveBeenCalledTimes(1);

    await expect(cancelWithdrawal(id)).resolves.toEqual({ ok: true, data: undefined });
    await expect(confirmWithdrawal({ ...by(id), code: '123456' })).resolves.toMatchObject({ ok: false });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('won’t use a code past its life', async () => {
    const id = await shop();
    await waiting(id);
    await expect(confirmWithdrawal({ ...by(id), code: '123456', now: new Date(Date.now() + 16 * 60_000) })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('money moves at most once', () => {
  it('turns a double press into one confirmation', async () => {
    const id = await shop();
    await waiting(id);
    confirm.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { kind: 'done', reference: 'TXN-ONCE' };
    });
    const results = await Promise.all([confirmWithdrawal({ ...by(id), code: '123456' }), confirmWithdrawal({ ...by(id), code: '123456' })]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('turns two starts into one withdrawal', async () => {
    const id = await shop();
    ask.mockResolvedValue({ kind: 'code-sent' });
    await Promise.all([startWithdrawal({ ...by(id), rawAmount: '100' }), startWithdrawal({ ...by(id), rawAmount: '100' })]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await rows(id)).toHaveLength(1);
  });

  it('never repeats an unanswered confirmation — it settles from the transactions', async () => {
    const id = await shop();
    await waiting(id);
    confirm.mockResolvedValueOnce({ kind: 'unknown', reason: 'timed out' });
    await expect(confirmWithdrawal({ ...by(id), code: '123456' })).resolves.toEqual({ ok: true, data: 'checking' });
    expect((await rows(id))[0].status).toBe('CONFIRMING');

    await expect(startWithdrawal({ ...by(id), rawAmount: '100' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/already in progress/) });
    await expect(saveAutoWithdraw(id, { ...OFF, enabled: true })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/in progress/) });

    state.mockResolvedValueOnce({ state: 'completed', reference: 'TXN-LATE' });
    await settleWithdrawals({ organizationId: id, now: new Date(Date.now() + 2 * 60_000) });
    expect((await rows(id))[0]).toMatchObject({ status: 'SENT', gatewayRef: 'TXN-LATE' });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('closes an unanswered one with no trace long after; never while EduPay can’t be asked', async () => {
    const id = await shop();
    await waiting(id);
    confirm.mockResolvedValueOnce({ kind: 'unknown', reason: 'timed out' });
    await confirmWithdrawal({ ...by(id), code: '123456' });
    const later = new Date(Date.now() + 20 * 60_000);

    state.mockResolvedValueOnce('unavailable');
    await settleWithdrawals({ organizationId: id, now: later });
    expect((await rows(id))[0].status).toBe('CONFIRMING');

    state.mockResolvedValueOnce('not-found');
    await settleWithdrawals({ organizationId: id, now: later });
    expect((await rows(id))[0].status).toBe('FAILED');
  });

  it('records money that came back, and tells the Owner once', async () => {
    const id = await shop();
    await waiting(id);
    confirm.mockResolvedValueOnce({ kind: 'done', reference: 'TXN-W' });
    await confirmWithdrawal({ ...by(id), code: '123456' });

    state.mockResolvedValue({ state: 'completed', reference: 'TXN-W' });
    await settleWithdrawals({ organizationId: id });
    expect((await rows(id))[0].status).toBe('SENT');
    expect(listOwnerNotice).not.toHaveBeenCalled();

    state.mockResolvedValue({ state: 'returned', reference: 'TXN-BACK' });
    await settleWithdrawals({ organizationId: id });
    await settleWithdrawals({ organizationId: id });
    expect((await rows(id))[0].status).toBe('RETURNED');
    expect(listOwnerNotice).toHaveBeenCalledTimes(1);
  });
});

describe('auto-withdraw', () => {
  it('always pays the verified account, whatever was set before', async () => {
    const id = await shop();
    auto.mockResolvedValue({ ...OFF, enabled: true, bankAccountId: 99 });
    await expect(payoutView(id)).resolves.toMatchObject({ autoElsewhere: true });

    vi.mocked(updateAutoWithdraw).mockResolvedValueOnce({ ok: true });
    await expect(saveAutoWithdraw(id, { ...OFF, enabled: true, reserve: 200 })).resolves.toEqual({ ok: true, data: undefined });
    expect(updateAutoWithdraw).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true, bankAccountId: 7, reserve: 200 }));
  });

  it('won’t turn on without the connected account', async () => {
    const id = await shop();
    accounts.mockResolvedValue([]);
    await expect(saveAutoWithdraw(id, { ...OFF, enabled: true })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Connect your bank account/) });
    expect(updateAutoWithdraw).not.toHaveBeenCalled();
  });
});

describe('who', () => {
  it('needs a two-step sign-in: a password alone can’t move money (14.5)', async () => {
    const id = await shop();
    session.organizationId = id;
    const input = { enabled: true, frequency: 'daily' as const, time: '06:05', dayOfWeek: null, dayOfMonth: null, minAmount: 500, maxAmount: null, reserve: 0, notifyOnRun: true };
    for (const method of ['credentials', null]) {
      session.signInMethod = method;
      await expect(startWithdrawalAction('5000')).resolves.toMatchObject({ success: false, error: expect.stringMatching(/two-step sign-in/) });
      await expect(saveAutoWithdrawAction(input)).resolves.toMatchObject({ success: false, error: expect.stringMatching(/two-step sign-in/) });
    }
    expect(ask).not.toHaveBeenCalled();
    expect(updateAutoWithdraw).not.toHaveBeenCalled();

    session.signInMethod = 'google';
    ask.mockResolvedValueOnce({ kind: 'code-sent' });
    await expect(startWithdrawalAction('5000')).resolves.toMatchObject({ success: true });
  });


  it('lets only the shop’s Owner withdraw or change auto-withdraw', async () => {
    const id = await shop();
    session.organizationId = id;
    session.roleName = 'Admin';
    const input = { enabled: true, frequency: 'daily' as const, time: '06:05', dayOfWeek: null, dayOfMonth: null, minAmount: 500, maxAmount: null, reserve: 0, notifyOnRun: true };

    await expect(startWithdrawalAction('5000')).resolves.toMatchObject({ success: false, error: expect.stringMatching(/owner/) });
    await expect(confirmWithdrawalAction('123456')).resolves.toMatchObject({ success: false, error: expect.stringMatching(/owner/) });
    await expect(saveAutoWithdrawAction(input)).resolves.toMatchObject({ success: false, error: expect.stringMatching(/owner/) });
    expect(ask).not.toHaveBeenCalled();
    expect(updateAutoWithdraw).not.toHaveBeenCalled();

    session.roleName = 'Owner';
    vi.mocked(updateAutoWithdraw).mockResolvedValueOnce({ ok: true });
    await expect(saveAutoWithdrawAction(input)).resolves.toMatchObject({ success: true });
    expect(updateAutoWithdraw).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ time: '06:05:00', bankAccountId: 7 }));
  });
});

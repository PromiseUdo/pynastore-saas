/*
 * Shop wallets (ROADMAP 20.4) against the real database, with EduPay faked.
 * What must hold: nothing goes to EduPay before the shop is approved; the
 * wallet is a `business` one, made from the reviewed contact details under
 * our `shop-{id}` reference; it uses the wallet EduPay already has for the
 * contact email only when that email is an Owner's proved one (EduPay keeps
 * one wallet per person); and a wallet from another EduPay server is set up
 * again.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({ mode: 'test' as 'test' | 'live' }));
vi.mock('@/lib/wallet/edupay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wallet/edupay')>()),
  edupayConfigured: () => true,
  walletEnvironment: () => server.mode,
  registerUser: vi.fn(),
  getWallet: vi.fn(async () => ({ balanceKobo: 1250000, currency: 'NGN', status: 'active', hasPin: false })),
  getTransactions: vi.fn(async () => ({ items: [], hasMore: false, total: 0 })),
}));

import { prisma } from '@/lib/prisma';
import { flushAfterTasks } from '@/lib/run-after';
import { registerUser } from '@/lib/wallet/edupay';
import { requestShopWallet, shopUserRef, shopWalletState, shopWalletView } from '@/lib/wallet/shop';
import { retryDueWallets } from '@/lib/wallet/shopper';

const register = vi.mocked(registerUser);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shops: string[] = [];
const users: string[] = [];

/** An Owner of the shop whose sign-up email is `email`. */
async function owner(organizationId: string, email: string, { proved = true } = {}) {
  const user = await prisma.user.create({ data: { email, emailVerified: proved ? new Date() : null } });
  users.push(user.id);
  const role = await prisma.role.create({ data: { organizationId, name: 'Owner', isSystem: true } });
  await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id } });
}

async function shop(status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' = 'VERIFIED', contactEmail = 'ada@example.com') {
  const org = await prisma.organization.create({ data: { name: 'Ada’s Fabrics', slug: `__test-shopwallet-${shops.length}-${suffix}` } });
  shops.push(org.id);
  await prisma.merchantPaymentAccount.create({
    data: {
      organizationId: org.id,
      businessName: 'Ada Fabrics Ltd',
      contactEmail,
      contactPhone: '+2348031234567',
      verificationStatus: status,
    },
  });
  return org.id;
}

const wallet = (organizationId: string) => prisma.shopWallet.findUnique({ where: { organizationId } });

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  await prisma.shopWallet.deleteMany({ where: { organizationId: { in: shops } } });
  await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId: { in: shops } } });
  await prisma.organization.deleteMany({ where: { id: { in: shops } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

beforeEach(() => {
  register.mockReset();
  server.mode = 'test';
});

describe('before approval', () => {
  it('sends nothing to EduPay, and says the wallet comes with approval', async () => {
    const waiting = await shop('PENDING');
    await requestShopWallet(waiting);
    await flushAfterTasks();

    expect(register).not.toHaveBeenCalled();
    expect(await wallet(waiting)).toBeNull();
    await expect(shopWalletState(waiting)).resolves.toBe('not-approved');
  });
});

describe('once approved', () => {
  it('makes a business wallet from the reviewed contact details', async () => {
    const id = await shop();
    register.mockResolvedValueOnce({ kind: 'created', uuid: 'u-shop', uniqId: 'Q-SHOP' });

    await requestShopWallet(id);
    await flushAfterTasks();

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        userType: 'business',
        userRef: shopUserRef(id),
        fullName: 'Ada Fabrics Ltd',
        email: 'ada@example.com',
        phone: '08031234567',
      }),
    );
    expect(await wallet(id)).toMatchObject({ status: 'ACTIVE', edupayUuid: 'u-shop', environment: server.mode });
    await expect(shopWalletState(id)).resolves.toBe('active');

    const view = await shopWalletView(id);
    expect(view).toMatchObject({ state: 'active', wallet: { balanceKobo: 1250000 }, transactions: [], total: 0 });
  });

  it('uses the Owner’s own wallet when EduPay already has one for their proved email', async () => {
    const email = `owner-${suffix}@example.com`;
    const id = await shop('VERIFIED', email.toUpperCase());
    await owner(id, email);
    register.mockResolvedValueOnce({ kind: 'exists', matchedOn: 'email', uuid: 'u-owner', uniqId: 'Q-OWNER', email });

    await requestShopWallet(id);
    await flushAfterTasks();

    expect(await wallet(id)).toMatchObject({ status: 'ACTIVE', origin: 'CONNECTED', edupayUuid: 'u-owner', edupayUniqId: 'Q-OWNER' });
    await expect(shopWalletView(id)).resolves.toMatchObject({ state: 'active', origin: 'CONNECTED' });
  });

  it('asks again as a personal wallet when EduPay says only "email taken"', async () => {
    const email = `taken-${suffix}@example.com`;
    const id = await shop('VERIFIED', email);
    await owner(id, email);
    register
      .mockResolvedValueOnce({ kind: 'rejected', code: 'EMAIL_TAKEN', message: 'Email is already in use by another account' })
      .mockResolvedValueOnce({ kind: 'exists', matchedOn: 'email', uuid: 'u-personal', uniqId: 'Q-P', email });

    await requestShopWallet(id);
    await flushAfterTasks();

    expect(register.mock.calls.map(([input]) => input.userType)).toEqual(['business', 'normal']);
    expect(await wallet(id)).toMatchObject({ status: 'ACTIVE', origin: 'CONNECTED', edupayUuid: 'u-personal' });
  });

  it('never connects a contact email no Owner proved to us', async () => {
    const stranger = await shop('VERIFIED', `someone-${suffix}@example.com`);
    const unproved = await shop('VERIFIED', `unproved-${suffix}@example.com`);
    await owner(unproved, `unproved-${suffix}@example.com`, { proved: false });

    for (const id of [stranger, unproved]) {
      const email = (await prisma.merchantPaymentAccount.findUniqueOrThrow({ where: { organizationId: id } })).contactEmail;
      register.mockResolvedValueOnce({ kind: 'exists', matchedOn: 'email', uuid: 'u-theirs', uniqId: 'Q-T', email });
      await requestShopWallet(id);
      await flushAfterTasks();
      expect(await wallet(id)).toMatchObject({ status: 'FAILED', edupayUuid: null });
      await expect(shopWalletState(id)).resolves.toBe('problem');
    }
  });

  it('is retried by the wallet-setup job when EduPay doesn’t answer', async () => {
    const id = await shop();
    register.mockResolvedValueOnce({ kind: 'unavailable', reason: 'timed out' });
    await requestShopWallet(id);
    await flushAfterTasks();

    const waiting = await wallet(id);
    expect(waiting).toMatchObject({ status: 'PENDING', attempts: 1 });

    register.mockResolvedValueOnce({ kind: 'created', uuid: 'u-later', uniqId: 'Q-L' });
    await retryDueWallets({ now: new Date(waiting!.nextAttemptAt!.getTime() + 1000) });
    expect(await wallet(id)).toMatchObject({ status: 'ACTIVE', edupayUuid: 'u-later' });
  });
});

describe('moving from EduPay’s test mode to live', () => {
  it('sets up again a wallet that was made in the other mode', async () => {
    const id = await shop();
    register.mockResolvedValueOnce({ kind: 'created', uuid: 'u-test', uniqId: 'Q-T' });
    await requestShopWallet(id);
    await flushAfterTasks();
    expect(await wallet(id)).toMatchObject({ edupayUuid: 'u-test' });

    server.mode = 'live';
    register.mockResolvedValueOnce({ kind: 'created', uuid: 'u-live', uniqId: 'Q-LIVE' });
    const view = await shopWalletView(id);

    expect(view.state).toBe('active');
    expect(await wallet(id)).toMatchObject({ status: 'ACTIVE', edupayUuid: 'u-live', environment: server.mode, userRef: shopUserRef(id) });
  });
});

/*
 * Shopper wallets (ROADMAP 20.2) against the real database, with EduPay
 * faked. What must hold: nothing goes to EduPay before the email is proved
 * and there is a phone; an existing wallet is connected only on a match of
 * the SAME proved email; a phone match is never connected; a busy EduPay is
 * retried later, and two requests at once register the person once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wallet/edupay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wallet/edupay')>()),
  edupayConfigured: () => true,
  registerUser: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { flushAfterTasks } from '@/lib/run-after';
import { registerUser, type RegisterResult } from '@/lib/wallet/edupay';
import {
  generateUsername,
  requestShopperWallet,
  retryAfterPhoneChange,
  retryDueWallets,
  setUpShopperWallet,
  shopperUserRef,
} from '@/lib/wallet/shopper';

const register = vi.mocked(registerUser);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-wallets-${suffix}` };

let n = 0;
async function shopper(over: { verified?: boolean; phone?: string | null } = {}) {
  n += 1;
  return prisma.customer.create({
    data: {
      organizationId: store.id,
      name: 'Ada Okafor',
      email: `ada-${n}-${suffix}@example.com`,
      phone: over.phone === undefined ? '+2348031234567' : over.phone,
      passwordHash: 'x',
      emailVerifiedAt: over.verified === false ? null : new Date(),
    },
  });
}

const wallet = (customerId: string) => prisma.shopperWallet.findUnique({ where: { customerId } });

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Wallet Store', slug: store.slug } })).id;
});

afterAll(async () => {
  await prisma.shopperWallet.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.delete({ where: { id: store.id } });
});

beforeEach(() => {
  register.mockReset();
});

describe('when a wallet is asked for', () => {
  it('waits for a proved email and a phone before telling EduPay anything', async () => {
    const unproved = await shopper({ verified: false });
    const phoneless = await shopper({ phone: null });
    await requestShopperWallet(unproved.id);
    await requestShopperWallet(phoneless.id);
    await flushAfterTasks();

    expect(register).not.toHaveBeenCalled();
    expect(await wallet(unproved.id)).toBeNull();
    expect(await wallet(phoneless.id)).toBeNull();
  });

  it('creates a new wallet, sending the phone the way EduPay takes it', async () => {
    const ada = await shopper();
    register.mockResolvedValueOnce({ kind: 'created', uuid: 'u-new', uniqId: 'Q-NEW' });

    await requestShopperWallet(ada.id);
    await flushAfterTasks();

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ userType: 'normal', userRef: shopperUserRef(ada.id), phone: '08031234567', email: ada.email }),
    );
    expect(await wallet(ada.id)).toMatchObject({ status: 'ACTIVE', origin: 'CREATED', edupayUuid: 'u-new', edupayUniqId: 'Q-NEW' });
  });
});

describe('an existing EduPay wallet', () => {
  it('is connected when EduPay matched the same, proved email', async () => {
    const ada = await shopper();
    register.mockResolvedValueOnce({ kind: 'exists', matchedOn: 'email', uuid: 'u-old', uniqId: 'Q-OLD', email: ada.email!.toUpperCase() });

    await requestShopperWallet(ada.id);
    await flushAfterTasks();

    expect(await wallet(ada.id)).toMatchObject({ status: 'ACTIVE', origin: 'CONNECTED', edupayUuid: 'u-old' });
  });

  it('is never connected on a phone match — the shopper changes their number, and it tries again', async () => {
    const ada = await shopper();
    register.mockResolvedValueOnce({ kind: 'exists', matchedOn: 'phone', uuid: 'u-stranger', uniqId: 'Q-S', email: 'stranger@example.com' });

    await requestShopperWallet(ada.id);
    await flushAfterTasks();
    expect(await wallet(ada.id)).toMatchObject({ status: 'PHONE_IN_USE', edupayUuid: null });

    await prisma.customer.update({ where: { id: ada.id }, data: { phone: '+2348051234567' } });
    register.mockResolvedValueOnce({ kind: 'created', uuid: 'u-ada', uniqId: 'Q-ADA' });
    await retryAfterPhoneChange(ada.id);
    await flushAfterTasks();

    expect(register).toHaveBeenLastCalledWith(expect.objectContaining({ phone: '08051234567' }));
    expect(await wallet(ada.id)).toMatchObject({ status: 'ACTIVE', edupayUuid: 'u-ada' });
  });

  it('is not connected when the email EduPay matched isn’t this shopper’s', async () => {
    const ada = await shopper();
    register.mockResolvedValueOnce({ kind: 'exists', matchedOn: 'email', uuid: 'u-x', uniqId: 'Q-X', email: 'someone-else@example.com' });

    await requestShopperWallet(ada.id);
    await flushAfterTasks();

    expect(await wallet(ada.id)).toMatchObject({ status: 'FAILED', edupayUuid: null });
  });
});

describe('when EduPay says no, or nothing', () => {
  it('tries a new username when one is taken', async () => {
    const ada = await shopper();
    register
      .mockResolvedValueOnce({ kind: 'username-taken' })
      .mockResolvedValueOnce({ kind: 'created', uuid: 'u1', uniqId: 'Q1' });

    await requestShopperWallet(ada.id);
    await flushAfterTasks();

    const usernames = register.mock.calls.map(([input]) => input.username);
    expect(usernames).toHaveLength(2);
    expect(usernames[0]).not.toBe(usernames[1]);
    expect(await wallet(ada.id)).toMatchObject({ status: 'ACTIVE' });
  });

  it('adopts the wallet an unanswered attempt made, when EduPay sends its ids', async () => {
    const ada = await shopper();
    register.mockResolvedValueOnce({ kind: 'user-ref-taken', uuid: 'u-lost', uniqId: 'Q-LOST' });
    await requestShopperWallet(ada.id);
    await flushAfterTasks();
    expect(await wallet(ada.id)).toMatchObject({ status: 'ACTIVE', edupayUuid: 'u-lost' });
  });

  it('waits and tries again when EduPay is unreachable', async () => {
    const ada = await shopper();
    register.mockResolvedValueOnce({ kind: 'unavailable', reason: 'timed out' });
    await requestShopperWallet(ada.id);
    await flushAfterTasks();

    const waiting = await wallet(ada.id);
    expect(waiting).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(waiting!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: the cron job leaves it alone.
    await retryDueWallets();
    expect(register).toHaveBeenCalledTimes(1);

    register.mockResolvedValueOnce({ kind: 'created', uuid: 'u-later', uniqId: 'Q-L' });
    await retryDueWallets({ now: new Date(waiting!.nextAttemptAt!.getTime() + 1000) });
    expect(await wallet(ada.id)).toMatchObject({ status: 'ACTIVE', edupayUuid: 'u-later', attempts: 2 });
  });

  it('registers the person once when two requests arrive together', async () => {
    const ada = await shopper();
    let release!: (value: RegisterResult) => void;
    register.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    await requestShopperWallet(ada.id);
    const first = setUpShopperWallet(ada.id);
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    await expect(setUpShopperWallet(ada.id)).resolves.toBe('skipped');

    release({ kind: 'created', uuid: 'u-once', uniqId: 'Q-1' });
    await expect(first).resolves.toBe('active');
    await flushAfterTasks(); // the queued attempt finds nothing left to do
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe('generateUsername', () => {
  it('is the name without spaces or accents, plus six random characters', () => {
    const name = generateUsername('Adaéze Okafor-Bello');
    expect(name).toMatch(/^adaezeokaforbell[a-z2-9]{6}$/);
    expect(generateUsername('李 明')).toMatch(/^shopper[a-z2-9]{6}$/);
    expect(generateUsername('Ada')).not.toBe(generateUsername('Ada'));
  });
});

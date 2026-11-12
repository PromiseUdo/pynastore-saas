/*
 * Shoppers prove their email with a six-digit code (ROADMAP 20.1), against
 * the real database in two throwaway stores.
 *
 * What must hold: only the newest code works, only at the store that sent
 * it, only until it expires, and only within five tries — and a right code
 * marks the address proved and spends every code for the account.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  MAX_ATTEMPTS,
  confirmVerificationCode,
  findPendingVerification,
  issueVerificationCode,
  normalizeCode,
} from '@/lib/storefront/account/email-verification';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const acme = { id: '', slug: `__test-verify-acme-${suffix}` };
const zed = { id: '', slug: `__test-verify-zed-${suffix}` };

let n = 0;
async function newShopper(orgId = acme.id) {
  n += 1;
  return prisma.customer.create({
    data: { organizationId: orgId, name: 'Ada Okafor', email: `ada-${n}-${suffix}@example.com`, passwordHash: 'x' },
  });
}

/** Any six digits that aren't the real code. */
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

beforeAll(async () => {
  acme.id = (await prisma.organization.create({ data: { name: 'Acme Store', slug: acme.slug } })).id;
  zed.id = (await prisma.organization.create({ data: { name: 'Zed Store', slug: zed.slug } })).id;
});

afterAll(async () => {
  for (const org of [acme, zed]) {
    await prisma.customerEmailVerification.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('normalizeCode', () => {
  it('forgives spaces and dashes, and refuses anything that isn’t six digits', () => {
    expect(normalizeCode(' 482 913 ')).toBe('482913');
    expect(normalizeCode('482-913')).toBe('482913');
    expect(normalizeCode('04829')).toBeNull();
    expect(normalizeCode('48291a')).toBeNull();
  });
});

describe('confirming a code', () => {
  it('proves the address with the right code, then spends it', async () => {
    const shopper = await newShopper();
    const issued = (await issueVerificationCode(shopper.id))!;
    expect(issued.code).toMatch(/^\d{6}$/);

    const pending = await findPendingVerification(acme.id, issued.rawToken);
    expect(pending).toMatchObject({ customerId: shopper.id, email: shopper.email, expired: false, locked: false });

    await expect(confirmVerificationCode(acme.id, issued.rawToken, issued.code)).resolves.toEqual({
      ok: true,
      customerId: shopper.id,
    });

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } });
    expect(after.emailVerifiedAt).not.toBeNull();
    await expect(prisma.customerEmailVerification.count({ where: { customerId: shopper.id } })).resolves.toBe(0);
    // Spent: the same code a second time is no challenge at all.
    await expect(confirmVerificationCode(acme.id, issued.rawToken, issued.code)).resolves.toEqual({
      ok: false,
      reason: 'no-challenge',
    });
  });

  it('refuses a wrong code without proving anything', async () => {
    const shopper = await newShopper();
    const issued = (await issueVerificationCode(shopper.id))!;

    await expect(confirmVerificationCode(acme.id, issued.rawToken, wrong(issued.code))).resolves.toEqual({
      ok: false,
      reason: 'wrong-code',
    });
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } });
    expect(after.emailVerifiedAt).toBeNull();
  });

  it('locks the code after five wrong tries — even the right code then fails', async () => {
    const shopper = await newShopper();
    const issued = (await issueVerificationCode(shopper.id))!;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await confirmVerificationCode(acme.id, issued.rawToken, wrong(issued.code));
    }
    await expect(confirmVerificationCode(acme.id, issued.rawToken, issued.code)).resolves.toEqual({
      ok: false,
      reason: 'locked',
    });
    await expect(findPendingVerification(acme.id, issued.rawToken)).resolves.toMatchObject({ locked: true });
  });

  it('refuses an expired code', async () => {
    const shopper = await newShopper();
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    const issued = (await issueVerificationCode(shopper.id, { now: longAgo }))!;

    await expect(confirmVerificationCode(acme.id, issued.rawToken, issued.code)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
    await expect(findPendingVerification(acme.id, issued.rawToken)).resolves.toMatchObject({ expired: true });
  });

  it('means nothing at another store', async () => {
    const shopper = await newShopper();
    const issued = (await issueVerificationCode(shopper.id))!;

    await expect(findPendingVerification(zed.id, issued.rawToken)).resolves.toBeNull();
    await expect(confirmVerificationCode(zed.id, issued.rawToken, issued.code)).resolves.toEqual({
      ok: false,
      reason: 'no-challenge',
    });
  });
});

describe('sending a new code', () => {
  it('waits a minute between codes unless the caller skips the cooldown', async () => {
    const shopper = await newShopper();
    expect(await issueVerificationCode(shopper.id)).not.toBeNull();
    expect(await issueVerificationCode(shopper.id)).toBeNull();
    expect(await issueVerificationCode(shopper.id, { cooldown: false })).not.toBeNull();
  });

  it('makes the earlier code useless', async () => {
    const shopper = await newShopper();
    const first = (await issueVerificationCode(shopper.id))!;
    const second = (await issueVerificationCode(shopper.id, { cooldown: false }))!;

    await expect(confirmVerificationCode(acme.id, first.rawToken, first.code)).resolves.toEqual({
      ok: false,
      reason: 'no-challenge',
    });
    await expect(confirmVerificationCode(acme.id, second.rawToken, second.code)).resolves.toMatchObject({ ok: true });
  });
});

/*
 * Shopper accounts against the real database, in two throwaway stores.
 *
 * Two stores rather than one, because the rule that matters most here can't
 * be tested with a single tenant: an account belongs to ONE merchant, and
 * the same person signing up at both must end up with two unrelated records
 * — neither of which can be opened with the other's password.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createPasswordResetToken,
  issueSessionToken,
  normalizeEmail,
  registerShopper,
  resetPasswordWithToken,
  upsertShopperFromGoogle,
  verifyShopperCredentials,
} from '@/lib/storefront/account/shopper';
import { verifySessionToken } from '@/lib/storefront/account/session';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const acme = { id: '', slug: `__test-acme-${suffix}` };
const zed = { id: '', slug: `__test-zed-${suffix}` };

const EMAIL = `ada-${suffix}@example.com`;
const PASSWORD = 'correct horse battery';

beforeAll(async () => {
  acme.id = (await prisma.organization.create({ data: { name: 'Acme Store', slug: acme.slug } })).id;
  zed.id = (await prisma.organization.create({ data: { name: 'Zed Store', slug: zed.slug } })).id;
});

afterAll(async () => {
  for (const org of [acme, zed]) {
    await prisma.customerOAuthAccount.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerPasswordResetToken.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.customerAddress.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('registering', () => {
  it('creates the account and signs the shopper in', async () => {
    const result = await registerShopper({
      organizationId: acme.id,
      name: 'Ada Okafor',
      email: EMAIL.toUpperCase(), // addresses are normalised, not taken as typed
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customer.email).toBe(normalizeEmail(EMAIL));

    const token = await issueSessionToken(acme.slug, result.customer);
    await expect(verifySessionToken(token, acme.slug)).resolves.toMatchObject({
      customerId: result.customer.id,
      organizationId: acme.id,
    });
  });

  it('refuses a second account on the same address at the same store', async () => {
    const again = await registerShopper({
      organizationId: acme.id,
      name: 'Someone Else',
      email: EMAIL,
      password: 'another password entirely',
    });

    expect(again).toEqual({ ok: false, reason: 'email-taken' });
  });

  it('claims a customer staff created, instead of making a second one', async () => {
    const email = `walkin-${suffix}@example.com`;
    const staffCreated = await prisma.customer.create({
      data: { organizationId: acme.id, name: 'Walk-in Customer', email, phone: '+234800' },
    });

    const result = await registerShopper({
      organizationId: acme.id,
      name: 'Chidi Walk-in',
      email,
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customer.id).toBe(staffCreated.id);
    // A claim is not proof of the address — order history must check this.
    expect(result.customer.emailVerifiedAt).toBeNull();

    const count = await prisma.customer.count({ where: { organizationId: acme.id, email } });
    expect(count).toBe(1);
  });
});

describe('signing in', () => {
  it('accepts the right password', async () => {
    const customer = await verifyShopperCredentials({
      organizationId: acme.id,
      email: EMAIL,
      password: PASSWORD,
    });
    expect(customer?.email).toBe(normalizeEmail(EMAIL));
  });

  it('refuses the wrong password, and an address with no account', async () => {
    await expect(
      verifyShopperCredentials({ organizationId: acme.id, email: EMAIL, password: 'nope' }),
    ).resolves.toBeNull();
    await expect(
      verifyShopperCredentials({ organizationId: acme.id, email: `ghost-${suffix}@example.com`, password: PASSWORD }),
    ).resolves.toBeNull();
  });

  it('refuses a deactivated customer', async () => {
    const email = `gone-${suffix}@example.com`;
    const result = await registerShopper({ organizationId: acme.id, name: 'Gone Away', email, password: PASSWORD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await prisma.customer.update({ where: { id: result.customer.id }, data: { status: 'INACTIVE' } });
    await expect(
      verifyShopperCredentials({ organizationId: acme.id, email, password: PASSWORD }),
    ).resolves.toBeNull();
  });
});

describe('one account belongs to one merchant', () => {
  it('keeps the same address at two stores completely separate', async () => {
    const atZed = await registerShopper({
      organizationId: zed.id,
      name: 'Ada Okafor',
      email: EMAIL,
      password: 'a different password at zed',
    });
    expect(atZed.ok).toBe(true);
    if (!atZed.ok) return;

    const atAcme = await verifyShopperCredentials({ organizationId: acme.id, email: EMAIL, password: PASSWORD });
    expect(atAcme).not.toBeNull();
    expect(atZed.customer.id).not.toBe(atAcme!.id);

    // Acme's password is worthless at Zed, and Zed's at Acme.
    await expect(
      verifyShopperCredentials({ organizationId: zed.id, email: EMAIL, password: PASSWORD }),
    ).resolves.toBeNull();
    await expect(
      verifyShopperCredentials({
        organizationId: acme.id,
        email: EMAIL,
        password: 'a different password at zed',
      }),
    ).resolves.toBeNull();
  });

  it('will not let a session from one store be read as a session at the other', async () => {
    const atAcme = await verifyShopperCredentials({ organizationId: acme.id, email: EMAIL, password: PASSWORD });
    const token = await issueSessionToken(acme.slug, atAcme!);

    await expect(verifySessionToken(token, zed.slug)).resolves.toBeNull();
  });
});

describe('Google sign-in', () => {
  it('creates an account, then finds the same one next time', async () => {
    const email = `google-${suffix}@example.com`;
    const first = await upsertShopperFromGoogle({
      organizationId: acme.id,
      googleSub: `sub-${suffix}`,
      email,
      name: 'Ngozi Google',
      emailVerified: true,
    });

    expect(first.emailVerifiedAt).not.toBeNull();

    const second = await upsertShopperFromGoogle({
      organizationId: acme.id,
      googleSub: `sub-${suffix}`,
      email,
      name: 'Ngozi Google',
      emailVerified: true,
    });

    expect(second.id).toBe(first.id);
    expect(await prisma.customer.count({ where: { organizationId: acme.id, email } })).toBe(1);
  });

  it('links to the existing password account rather than colliding with it', async () => {
    const linked = await upsertShopperFromGoogle({
      organizationId: acme.id,
      googleSub: `sub-existing-${suffix}`,
      email: EMAIL,
      name: 'Ada Okafor',
      emailVerified: true,
    });

    const byPassword = await verifyShopperCredentials({
      organizationId: acme.id,
      email: EMAIL,
      password: PASSWORD,
    });

    // One person, one record — and the password still works afterwards.
    expect(linked.id).toBe(byPassword!.id);
  });

  it('gives the same Google identity a separate account at each store', async () => {
    const email = `shared-${suffix}@example.com`;
    const sub = `sub-shared-${suffix}`;

    const atAcme = await upsertShopperFromGoogle({
      organizationId: acme.id, googleSub: sub, email, name: 'Shared Shopper', emailVerified: true,
    });
    const atZed = await upsertShopperFromGoogle({
      organizationId: zed.id, googleSub: sub, email, name: 'Shared Shopper', emailVerified: true,
    });

    expect(atAcme.id).not.toBe(atZed.id);
    expect(atAcme.organizationId).toBe(acme.id);
    expect(atZed.organizationId).toBe(zed.id);
  });
});

describe('password reset', () => {
  it('sets the new password, invalidates old sessions, and spends the link', async () => {
    const email = `reset-${suffix}@example.com`;
    const created = await registerShopper({
      organizationId: acme.id, name: 'Reset Me', email, password: PASSWORD,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const oldSession = await issueSessionToken(acme.slug, created.customer);

    const issued = await createPasswordResetToken({ organizationId: acme.id, email });
    expect(issued).not.toBeNull();

    const result = await resetPasswordWithToken({
      organizationId: acme.id,
      rawToken: issued!.rawToken,
      newPassword: 'a brand new password',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The new password works and the old one doesn't.
    await expect(
      verifyShopperCredentials({ organizationId: acme.id, email, password: 'a brand new password' }),
    ).resolves.not.toBeNull();
    await expect(
      verifyShopperCredentials({ organizationId: acme.id, email, password: PASSWORD }),
    ).resolves.toBeNull();

    // Whoever held a session before the reset is signed out: the token still
    // verifies as a signature, but its session version is now behind.
    const claims = await verifySessionToken(oldSession, acme.slug);
    expect(claims!.sessionVersion).not.toBe(result.customer.sessionVersion);

    // And the link cannot be used again.
    await expect(
      resetPasswordWithToken({
        organizationId: acme.id,
        rawToken: issued!.rawToken,
        newPassword: 'third password',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-token' });
  });

  it('refuses a reset token presented at another store', async () => {
    const email = `cross-${suffix}@example.com`;
    const created = await registerShopper({
      organizationId: acme.id, name: 'Cross Store', email, password: PASSWORD,
    });
    expect(created.ok).toBe(true);

    const issued = await createPasswordResetToken({ organizationId: acme.id, email });
    await expect(
      resetPasswordWithToken({
        organizationId: zed.id,
        rawToken: issued!.rawToken,
        newPassword: 'not happening',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-token' });
  });

  it('says nothing about an address with no account', async () => {
    await expect(
      createPasswordResetToken({ organizationId: acme.id, email: `nobody-${suffix}@example.com` }),
    ).resolves.toBeNull();
  });
});

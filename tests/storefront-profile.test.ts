/*
 * What a signed-in shopper may change about themselves, against the real DB.
 *
 * The cases worth pinning are the ones where being *already* signed in isn't
 * enough: changing a password or an email must still prove the password,
 * because the person at the keyboard isn't necessarily the account holder —
 * and both must invalidate every other session once they succeed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createPasswordResetToken,
  registerShopper,
  resetPasswordWithToken,
  upsertShopperFromGoogle,
  verifyShopperCredentials,
} from '@/lib/storefront/account/shopper';
import { getSignInMethods, setPassword, updateProfile } from '@/lib/storefront/account/profile';
import {
  confirmEmailChange,
  getPendingEmailChange,
  requestEmailChange,
} from '@/lib/storefront/account/email-change';
import { issueSessionToken } from '@/lib/storefront/account/shopper';
import { verifySessionToken } from '@/lib/storefront/account/session';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-profile-${suffix}` };
const other = { id: '', slug: `__test-profile-other-${suffix}` };

const EMAIL = `ada-${suffix}@example.com`;
const PASSWORD = 'first password here';
let customerId = '';

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Profile Store', slug: store.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug } })).id;

  const created = await registerShopper({
    organizationId: store.id,
    name: 'Ada Okafor',
    email: EMAIL,
    password: PASSWORD,
  });
  if (!created.ok) throw new Error('setup failed');
  customerId = created.customer.id;
});

afterAll(async () => {
  for (const org of [store, other]) {
    await prisma.customerOAuthAccount.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerPasswordResetToken.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.customerEmailChange.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('name and phone', () => {
  it('saves both, trimming what was typed', async () => {
    const updated = await updateProfile({
      organizationId: store.id,
      customerId,
      name: '  Ada N. Okafor  ',
      phone: ' +234 800 111 2222 ',
    });

    expect(updated?.name).toBe('Ada N. Okafor');
    expect(updated?.phone).toBe('+234 800 111 2222');
  });

  it('clears the phone when it is emptied', async () => {
    const updated = await updateProfile({ organizationId: store.id, customerId, name: 'Ada N. Okafor', phone: null });
    expect(updated?.phone).toBeNull();
  });

  it('will not touch a customer belonging to another store', async () => {
    await expect(
      updateProfile({ organizationId: other.id, customerId, name: 'Hijacked', phone: null }),
    ).resolves.toBeNull();

    const untouched = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } });
    expect(untouched?.name).toBe('Ada N. Okafor');
  });
});

describe('changing a password', () => {
  it('refuses without the current one', async () => {
    await expect(
      setPassword({ organizationId: store.id, customerId, currentPassword: 'wrong', newPassword: 'brand new password' }),
    ).resolves.toEqual({ ok: false, reason: 'wrong-password' });

    await expect(
      setPassword({ organizationId: store.id, customerId, newPassword: 'brand new password' }),
    ).resolves.toEqual({ ok: false, reason: 'wrong-password' });
  });

  it('changes it, and invalidates every session issued so far', async () => {
    const before = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { sessionVersion: true },
    });

    const result = await setPassword({
      organizationId: store.id,
      customerId,
      currentPassword: PASSWORD,
      newPassword: 'brand new password',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customer.sessionVersion).toBe(before.sessionVersion + 1);

    await expect(
      verifyShopperCredentials({ organizationId: store.id, email: EMAIL, password: 'brand new password' }),
    ).resolves.not.toBeNull();
    await expect(
      verifyShopperCredentials({ organizationId: store.id, email: EMAIL, password: PASSWORD }),
    ).resolves.toBeNull();
  });
});

describe('changing an email', () => {
  const NEW_EMAIL = `ada-new-${suffix}@example.com`;
  const CURRENT_PASSWORD = 'brand new password';

  it('refuses without the password, and changes nothing', async () => {
    await expect(
      requestEmailChange({ organizationId: store.id, customerId, newEmail: NEW_EMAIL, currentPassword: 'nope' }),
    ).resolves.toEqual({ ok: false, reason: 'wrong-password' });

    await expect(getPendingEmailChange(store.id, customerId)).resolves.toBeNull();
  });

  it('refuses an address already used at this store', async () => {
    const taken = `taken-${suffix}@example.com`;
    await registerShopper({ organizationId: store.id, name: 'Someone', email: taken, password: PASSWORD });

    await expect(
      requestEmailChange({ organizationId: store.id, customerId, newEmail: taken, currentPassword: CURRENT_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: 'email-taken' });
  });

  it('does NOT move the address when the change is only requested', async () => {
    const before = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { email: true },
    });

    const requested = await requestEmailChange({
      organizationId: store.id,
      customerId,
      newEmail: NEW_EMAIL,
      currentPassword: CURRENT_PASSWORD,
    });

    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    // The old address is handed back so the "was this you?" notice can be sent.
    expect(requested.previousEmail).toBe(before.email);

    const after = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { email: true },
    });
    expect(after.email).toBe(before.email);

    await expect(getPendingEmailChange(store.id, customerId)).resolves.toMatchObject({
      newEmail: NEW_EMAIL,
    });
  });

  it('asking again replaces the pending request, so an abandoned typo cannot be confirmed later', async () => {
    const typo = `typo-${suffix}@example.com`;
    const first = await requestEmailChange({
      organizationId: store.id, customerId, newEmail: typo, currentPassword: CURRENT_PASSWORD,
    });
    const second = await requestEmailChange({
      organizationId: store.id, customerId, newEmail: NEW_EMAIL, currentPassword: CURRENT_PASSWORD,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    await expect(
      confirmEmailChange({ organizationId: store.id, rawToken: first.rawToken }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-token' });

    await expect(getPendingEmailChange(store.id, customerId)).resolves.toMatchObject({
      newEmail: NEW_EMAIL,
    });
  });

  it('moves the address once the link is opened, marks it verified, and retires old sessions', async () => {
    const before = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { sessionVersion: true, email: true },
    });

    const requested = await requestEmailChange({
      organizationId: store.id, customerId, newEmail: NEW_EMAIL, currentPassword: CURRENT_PASSWORD,
    });
    if (!requested.ok) throw new Error('request failed');

    const confirmed = await confirmEmailChange({ organizationId: store.id, rawToken: requested.rawToken });

    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.customer.email).toBe(NEW_EMAIL);
    expect(confirmed.customer.emailVerifiedAt).not.toBeNull();
    expect(confirmed.customer.sessionVersion).toBe(before.sessionVersion + 1);
    expect(confirmed.previousEmail).toBe(before.email);

    // The new address signs in; the old one no longer exists here.
    await expect(
      verifyShopperCredentials({ organizationId: store.id, email: NEW_EMAIL, password: CURRENT_PASSWORD }),
    ).resolves.not.toBeNull();
    await expect(
      verifyShopperCredentials({ organizationId: store.id, email: before.email!, password: CURRENT_PASSWORD }),
    ).resolves.toBeNull();
  });

  it('spends the link exactly once — a second open (or a mail scanner) changes nothing', async () => {
    const again = `again-${suffix}@example.com`;
    const requested = await requestEmailChange({
      organizationId: store.id, customerId, newEmail: again, currentPassword: CURRENT_PASSWORD,
    });
    if (!requested.ok) throw new Error('request failed');

    await expect(confirmEmailChange({ organizationId: store.id, rawToken: requested.rawToken })).resolves.toMatchObject({ ok: true });
    await expect(confirmEmailChange({ organizationId: store.id, rawToken: requested.rawToken })).resolves.toEqual({
      ok: false,
      reason: 'invalid-token',
    });
  });

  it('refuses a link presented at another store', async () => {
    const elsewhere = `elsewhere-${suffix}@example.com`;
    const requested = await requestEmailChange({
      organizationId: store.id, customerId, newEmail: elsewhere, currentPassword: CURRENT_PASSWORD,
    });
    if (!requested.ok) throw new Error('request failed');

    await expect(
      confirmEmailChange({ organizationId: other.id, rawToken: requested.rawToken }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-token' });
  });

  it('refuses an expired link', async () => {
    const late = `late-${suffix}@example.com`;
    const requested = await requestEmailChange({
      organizationId: store.id, customerId, newEmail: late, currentPassword: CURRENT_PASSWORD,
    });
    if (!requested.ok) throw new Error('request failed');

    await prisma.customerEmailChange.updateMany({
      where: { customerId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      confirmEmailChange({ organizationId: store.id, rawToken: requested.rawToken }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-token' });
  });

  it('refuses at confirm time if someone took the address in the meantime', async () => {
    const contested = `contested-${suffix}@example.com`;
    const requested = await requestEmailChange({
      organizationId: store.id, customerId, newEmail: contested, currentPassword: CURRENT_PASSWORD,
    });
    if (!requested.ok) throw new Error('request failed');

    // Days pass; another shopper registers with it first.
    await registerShopper({ organizationId: store.id, name: 'Faster', email: contested, password: PASSWORD });

    await expect(
      confirmEmailChange({ organizationId: store.id, rawToken: requested.rawToken }),
    ).resolves.toEqual({ ok: false, reason: 'email-taken' });
  });
});

describe('a Google-only account', () => {
  it('reports how it signs in, may add a password without proving one, and cannot move its email before that', async () => {
    const email = `google-${suffix}@example.com`;
    const google = await upsertShopperFromGoogle({
      organizationId: store.id,
      googleSub: `sub-${suffix}`,
      email,
      name: 'Ngozi Google',
      emailVerified: true,
    });

    await expect(getSignInMethods(store.id, google.id)).resolves.toEqual({ hasPassword: false, google: true });

    await expect(
      requestEmailChange({
        organizationId: store.id,
        customerId: google.id,
        newEmail: `moved-${suffix}@example.com`,
        currentPassword: 'anything',
      }),
    ).resolves.toEqual({ ok: false, reason: 'no-password' });

    // No current password to prove — there has never been one.
    const added = await setPassword({
      organizationId: store.id,
      customerId: google.id,
      newPassword: 'a first password',
    });
    expect(added.ok).toBe(true);

    await expect(getSignInMethods(store.id, google.id)).resolves.toEqual({ hasPassword: true, google: true });
    await expect(
      verifyShopperCredentials({ organizationId: store.id, email, password: 'a first password' }),
    ).resolves.not.toBeNull();
  });
});

describe('staying signed in through your own change', () => {
  it('re-issued cookie works while the pre-change one is stale', async () => {
    const email = `keepme-${suffix}@example.com`;
    const created = await registerShopper({
      organizationId: store.id, name: 'Keep Me', email, password: PASSWORD,
    });
    if (!created.ok) throw new Error('setup failed');

    const before = await issueSessionToken(store.slug, created.customer);

    const changed = await setPassword({
      organizationId: store.id,
      customerId: created.customer.id,
      currentPassword: PASSWORD,
      newPassword: 'a replacement password',
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    // What the action re-issues: same person, the version the change produced.
    const after = await issueSessionToken(store.slug, changed.customer);

    const staleClaims = await verifySessionToken(before, store.slug);
    const freshClaims = await verifySessionToken(after, store.slug);

    expect(freshClaims!.sessionVersion).toBe(changed.customer.sessionVersion);
    // The old one is still a valid signature — it is the version that retires
    // it, which is exactly what getShopper() compares against the database.
    expect(staleClaims!.sessionVersion).toBe(changed.customer.sessionVersion - 1);
  });
});

describe('taking back control', () => {
  it('changing the password cancels a pending email change', async () => {
    const email = `recover-${suffix}@example.com`;
    const created = await registerShopper({
      organizationId: store.id, name: 'Recover Me', email, password: PASSWORD,
    });
    if (!created.ok) throw new Error('setup failed');

    const requested = await requestEmailChange({
      organizationId: store.id,
      customerId: created.customer.id,
      newEmail: `stolen-${suffix}@example.com`,
      currentPassword: PASSWORD,
    });
    if (!requested.ok) throw new Error('request failed');

    // This is exactly what the notice to the old address tells them to do.
    const changed = await setPassword({
      organizationId: store.id,
      customerId: created.customer.id,
      currentPassword: PASSWORD,
      newPassword: 'taking it back now',
    });
    expect(changed.ok).toBe(true);

    await expect(getPendingEmailChange(store.id, created.customer.id)).resolves.toBeNull();
    await expect(
      confirmEmailChange({ organizationId: store.id, rawToken: requested.rawToken }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-token' });
  });

  it('a password reset does the same, for someone who is locked out', async () => {
    const email = `locked-${suffix}@example.com`;
    const created = await registerShopper({
      organizationId: store.id, name: 'Locked Out', email, password: PASSWORD,
    });
    if (!created.ok) throw new Error('setup failed');

    const requested = await requestEmailChange({
      organizationId: store.id,
      customerId: created.customer.id,
      newEmail: `hijack-${suffix}@example.com`,
      currentPassword: PASSWORD,
    });
    if (!requested.ok) throw new Error('request failed');

    const issued = await createPasswordResetToken({ organizationId: store.id, email });
    const reset = await resetPasswordWithToken({
      organizationId: store.id,
      rawToken: issued!.rawToken,
      newPassword: 'recovered password',
    });
    expect(reset.ok).toBe(true);

    await expect(getPendingEmailChange(store.id, created.customer.id)).resolves.toBeNull();
  });
});

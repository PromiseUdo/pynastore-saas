/*
 * Staff account security (ROADMAP 14.5), against the real database: two-step
 * sign-in is set up only with a code from the app; afterwards a password
 * alone never signs in; a code works once, a backup code once; the sign-in
 * ticket needs the right code and is spent once; keeping this session when
 * the others are signed out can't be done with someone else's ticket, or
 * twice; and changing a password or an email is checked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Two-step secrets are sealed like social tokens (lib/social/crypto.ts): a test key of the right size.
process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { open, resetSocialKeyCache } from '@/lib/social/crypto';
import { stepAt, totpCode } from '@/lib/account-security/totp';
import {
  answerSignInChallenge,
  checkSecondFactor,
  confirmTwoFactorSetup,
  createSignInChallenge,
  disableTwoFactor,
  spendSignInChallenge,
  startTwoFactorSetup,
  twoFactorStatus,
} from '@/lib/account-security/two-factor';
import { userForPassword } from '@/lib/account-security/password-sign-in';
import { hashTicket, spendRenewTicket } from '@/lib/account-security/renew';
import { changePassword, confirmEmailChange, requestEmailChange } from '@/lib/account-security/account';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const users: string[] = [];
const PASSWORD = 'correct horse battery';

async function person(label: string) {
  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.com`, name: 'Ada', password: await hash(PASSWORD, 4), emailVerified: new Date() },
  });
  users.push(user.id);
  return user;
}

/** Turn two-step sign-in on, as the app would: scan, then type the code. */
async function withTwoFactor(label: string, at = new Date()) {
  const user = await person(label);
  const started = await startTwoFactorSetup(user.id);
  if (!started || started === 'already-on') throw new Error('not started');
  const secret = started.secret.replace(/\s/g, '');
  const done = await confirmTwoFactorSetup(user.id, totpCode(secret, stepAt(at)), at);
  if (!done.ok) throw new Error('not confirmed');
  return { user, secret, recoveryCodes: done.recoveryCodes };
}

beforeAll(() => {
  resetSocialKeyCache();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe('setting it up', () => {
  it('turns on only with a code from the app, and gives ten backup codes once', async () => {
    const user = await person('setup');
    const started = await startTwoFactorSetup(user.id);
    if (!started || started === 'already-on') throw new Error('not started');
    expect(started.qr).toMatch(/^data:image\/png;base64,/);
    const secret = started.secret.replace(/\s/g, '');

    // Kept sealed, and only as pending.
    const pending = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(pending.twoFactorPendingSecret).not.toContain(secret);
    expect(open(pending.twoFactorPendingSecret!)).toBe(secret);
    expect(pending.twoFactorEnabledAt).toBeNull();

    await expect(confirmTwoFactorSetup(user.id, '000000')).resolves.toEqual({ ok: false, reason: 'wrong-code' });
    const done = await confirmTwoFactorSetup(user.id, totpCode(secret, stepAt(new Date())));
    expect(done).toMatchObject({ ok: true });
    if (!done.ok) return;
    expect(done.recoveryCodes).toHaveLength(10);
    await expect(twoFactorStatus(user.id)).resolves.toEqual({ enabled: true, recoveryCodesLeft: 10 });

    const stored = await prisma.userRecoveryCode.findMany({ where: { userId: user.id } });
    expect(stored.map((c) => c.codeHash)).not.toContain(done.recoveryCodes[0]);
  });

  it('isn’t offered to an account without a password', async () => {
    const user = await prisma.user.create({ data: { email: `google-${suffix}@example.com`, name: 'G' } });
    users.push(user.id);
    await expect(startTwoFactorSetup(user.id)).resolves.toBeNull();
  });
});

describe('signing in', () => {
  it('never signs in with the password alone once it’s on', async () => {
    const plain = await person('plain');
    await expect(userForPassword({ email: plain.email, password: PASSWORD })).resolves.toMatchObject({ id: plain.id });

    const { user } = await withTwoFactor('locked');
    await expect(userForPassword({ email: user.email, password: PASSWORD })).resolves.toBeNull();
  });

  it('takes an app code once, and a backup code once', async () => {
    const now = new Date();
    const { user, secret, recoveryCodes } = await withTwoFactor('codes', new Date(now.getTime() - 90_000));
    const code = totpCode(secret, stepAt(now));
    await expect(checkSecondFactor(user.id, code, now)).resolves.toBe('app');
    await expect(checkSecondFactor(user.id, code, now)).resolves.toBeNull(); // replayed

    await expect(checkSecondFactor(user.id, recoveryCodes[0].toUpperCase(), now)).resolves.toBe('recovery');
    await expect(checkSecondFactor(user.id, recoveryCodes[0], now)).resolves.toBeNull();
    await expect(checkSecondFactor(user.id, 'not-a-code', now)).resolves.toBeNull();
  });

  it('spends the sign-in ticket once, only after the right code', async () => {
    const now = new Date();
    const { user, secret } = await withTwoFactor('ticket', new Date(now.getTime() - 90_000));
    const token = await createSignInChallenge(user.id, now);

    await expect(spendSignInChallenge(token, now)).resolves.toBeNull(); // no code yet
    await expect(answerSignInChallenge(token, '000000', now)).resolves.toBe('wrong-code');
    await expect(answerSignInChallenge(token, totpCode(secret, stepAt(now)), now)).resolves.toBe('ok');
    await expect(spendSignInChallenge(token, now)).resolves.toBe(user.id);
    await expect(spendSignInChallenge(token, now)).resolves.toBeNull();
  });

  it('ends a ticket after five wrong codes, and after ten minutes', async () => {
    const now = new Date();
    const { user, secret } = await withTwoFactor('attempts', new Date(now.getTime() - 90_000));
    const token = await createSignInChallenge(user.id, now);
    for (let i = 0; i < 5; i++) await answerSignInChallenge(token, '000000', now);
    await expect(answerSignInChallenge(token, totpCode(secret, stepAt(now)), now)).resolves.toBe('expired');

    const late = await createSignInChallenge(user.id, now);
    await expect(answerSignInChallenge(late, totpCode(secret, stepAt(now)), new Date(now.getTime() + 11 * 60_000))).resolves.toBe('expired');
  });

  it('turns off only with a current code', async () => {
    const now = new Date();
    const { user, secret } = await withTwoFactor('off', new Date(now.getTime() - 90_000));
    await expect(disableTwoFactor(user.id, '000000')).resolves.toBe(false);
    await expect(disableTwoFactor(user.id, totpCode(secret, stepAt(new Date())))).resolves.toBe(true);
    await expect(twoFactorStatus(user.id)).resolves.toEqual({ enabled: false, recoveryCodesLeft: 0 });
    await expect(userForPassword({ email: user.email, password: PASSWORD })).resolves.toMatchObject({ id: user.id });
  });
});

describe('keeping this session when the others are signed out', () => {
  it('needs this person’s own ticket, spent once', async () => {
    const ada = await person('renew-a');
    const tunde = await person('renew-b');
    await prisma.user.update({ where: { id: ada.id }, data: { sessionVersion: 3 } });
    const token = 'x'.repeat(43);
    await prisma.authTicket.create({ data: { userId: ada.id, purpose: 'RENEW', tokenHash: hashTicket(token), expiresAt: new Date(Date.now() + 60_000), verifiedAt: new Date() } });

    await expect(spendRenewTicket(tunde.id, token)).resolves.toBeNull();
    await expect(spendRenewTicket(ada.id, token)).resolves.toEqual({ version: 3, provedSecondFactor: true });
    await expect(spendRenewTicket(ada.id, token)).resolves.toBeNull();
    await expect(spendRenewTicket(ada.id, 'made-up-ticket-made-up-ticket')).resolves.toBeNull();
  });
});

describe('password and email', () => {
  it('changes the password only with the current one', async () => {
    const user = await person('password');
    await expect(changePassword(user.id, { current: 'wrong', next: 'a whole new password' })).resolves.toMatchObject({ ok: false, field: 'current' });
    await expect(changePassword(user.id, { current: PASSWORD, next: 'short' })).resolves.toMatchObject({ ok: false, field: 'next' });
    await expect(changePassword(user.id, { current: PASSWORD, next: PASSWORD })).resolves.toMatchObject({ ok: false, field: 'next' });
    await expect(changePassword(user.id, { current: PASSWORD, next: 'a whole new password' })).resolves.toMatchObject({ ok: true });
    await expect(userForPassword({ email: user.email, password: 'a whole new password' })).resolves.toMatchObject({ id: user.id });
  });

  it('moves the email only from the link, and never onto someone else’s address', async () => {
    const user = await person('email');
    const other = await person('taken');
    await expect(requestEmailChange(user.id, { newEmail: 'new@example.com', password: 'wrong' })).resolves.toMatchObject({ ok: false, field: 'password' });

    const newEmail = `moved-${suffix}@example.com`;
    const asked = await requestEmailChange(user.id, { newEmail, password: PASSWORD });
    if (!asked.ok) throw new Error('not asked');
    expect(asked.deliver).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email); // not yet
    await expect(confirmEmailChange(asked.token)).resolves.toEqual({ ok: true, email: newEmail });
    await expect(confirmEmailChange(asked.token)).resolves.toMatchObject({ ok: false });

    // Someone else's address: the same answer, nothing sent, and the link can't work.
    const taken = await requestEmailChange(user.id, { newEmail: other.email, password: PASSWORD });
    if (!taken.ok) throw new Error('should look the same');
    expect(taken.deliver).toBe(false);
    await expect(confirmEmailChange(taken.token)).resolves.toMatchObject({ ok: false });
  });
});

/*
 * lib/storefront/account/email-verification.ts
 *
 * Proving a shopper owns their email (ROADMAP 20.1). Server only.
 *
 * THE RULE. No shopper session exists for an address nobody has proved.
 * Google proves it (google.ts refuses an unverified Google address), a
 * password reset proves it, an email change proves the new one — and a
 * password registration proves nothing, so it ends here: a six-digit code
 * sent to the address, typed back on the store's own page. `getShopper()`
 * enforces the rule for sessions issued before it existed.
 *
 * Why it matters beyond the account itself: a shopper record can carry
 * guest orders placed with that address and, from Phase 20, a wallet
 * connected by email. Whoever registers an address must own it.
 *
 * A CODE, NOT A LINK. The store apps (Phase 16) and the mobile host keep the
 * shopper on the store's page; a code typed there works everywhere, while a
 * link opens whichever browser the mail app picks — signed in to nothing.
 *
 * HOW A CODE IS HELD. The browser gets a random token in a host-only cookie
 * naming WHICH challenge it is answering; the row stores its SHA-256. The
 * code is stored only as an HMAC keyed by AUTH_SECRET and bound to that
 * token, so a copy of the table can't be brute-forced into codes, and five
 * wrong tries spend the challenge.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { accountSigningKey, isSecureRequest } from './session';

export const CODE_TTL_MINUTES = 15;
export const MAX_ATTEMPTS = 5;
/** Don't send another code within this long of the last. */
export const RESEND_COOLDOWN_SECONDS = 60;

export function verifyCookieName(orgSlug: string): string {
  return `sf-verify-${orgSlug}`;
}

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

function codeHashFor(tokenHash: string, code: string): string {
  return createHmac('sha256', accountSigningKey()).update(`${tokenHash}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Six digits, leading zeros kept. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** What the shopper typed, as a code — spaces and dashes forgiven. */
export function normalizeCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/* ---------------- issuing ---------------- */

export type IssuedCode = { rawToken: string; code: string; expiresAt: Date };

/**
 * A fresh code for this customer, replacing any earlier one: only the
 * newest code works, so "send a new code" never leaves two live ones.
 *
 * Returns null inside the resend cooldown. Registering and signing in pass
 * `cooldown: false`: both already needed the password and are rate-limited,
 * and a shopper signing in on a second device needs a code for THAT device.
 */
export async function issueVerificationCode(
  customerId: string,
  { now = new Date(), cooldown = true }: { now?: Date; cooldown?: boolean } = {},
): Promise<IssuedCode | null> {
  if (cooldown) {
    const latest = await prisma.customerEmailVerification.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) return null;
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256(rawToken);
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);

  await prisma.$transaction([
    prisma.customerEmailVerification.deleteMany({ where: { customerId } }),
    prisma.customerEmailVerification.create({
      data: { customerId, tokenHash, codeHash: codeHashFor(tokenHash, code), expiresAt, createdAt: now },
    }),
  ]);

  return { rawToken, code, expiresAt };
}

/* ---------------- the challenge a browser is answering ---------------- */

export interface PendingVerification {
  customerId: string;
  email: string;
  name: string;
  expired: boolean;
  /** Spent by too many wrong tries — only a new code helps. */
  locked: boolean;
  /** Seconds until "Send a new code" is allowed; 0 when it is. */
  resendInSeconds: number;
}

/**
 * The challenge behind a cookie token, at THIS store. A token from another
 * store, or for an account since verified or closed, is no challenge.
 */
export async function findPendingVerification(
  organizationId: string,
  rawToken: string,
  now = new Date(),
): Promise<PendingVerification | null> {
  if (!rawToken) return null;
  const row = await prisma.customerEmailVerification.findUnique({
    where: { tokenHash: sha256(rawToken) },
    select: {
      attempts: true,
      expiresAt: true,
      createdAt: true,
      customer: { select: { id: true, organizationId: true, email: true, name: true, status: true, emailVerifiedAt: true } },
    },
  });
  const customer = row?.customer;
  if (!row || !customer?.email) return null;
  if (customer.organizationId !== organizationId || customer.status !== 'ACTIVE' || customer.emailVerifiedAt) return null;

  const sinceSent = Math.floor((now.getTime() - row.createdAt.getTime()) / 1000);
  return {
    customerId: customer.id,
    email: customer.email,
    name: customer.name,
    expired: row.expiresAt <= now,
    locked: row.attempts >= MAX_ATTEMPTS,
    resendInSeconds: Math.max(0, RESEND_COOLDOWN_SECONDS - sinceSent),
  };
}

export type ConfirmResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: 'no-challenge' | 'expired' | 'locked' | 'wrong-code' };

/**
 * Check a typed code. Right: the address is proved and every code for the
 * account is spent. Wrong: one of the five tries is used up — counted with a
 * conditional update first, so parallel guesses can't share a try.
 */
export async function confirmVerificationCode(
  organizationId: string,
  rawToken: string,
  typed: string,
  now = new Date(),
): Promise<ConfirmResult> {
  const tokenHash = sha256(rawToken);
  const row = await prisma.customerEmailVerification.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      codeHash: true,
      expiresAt: true,
      customer: { select: { id: true, organizationId: true, status: true } },
    },
  });
  if (!row || row.customer.organizationId !== organizationId || row.customer.status !== 'ACTIVE') {
    return { ok: false, reason: 'no-challenge' };
  }
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' };

  const counted = await prisma.customerEmailVerification.updateMany({
    where: { id: row.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) return { ok: false, reason: 'locked' };

  const code = normalizeCode(typed);
  if (!code || !sameHash(codeHashFor(tokenHash, code), row.codeHash)) return { ok: false, reason: 'wrong-code' };

  await prisma.$transaction([
    prisma.customer.updateMany({
      where: { id: row.customer.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    }),
    prisma.customerEmailVerification.deleteMany({ where: { customerId: row.customer.id } }),
  ]);
  return { ok: true, customerId: row.customer.id };
}

/* ---------------- the cookie ---------------- */

export async function readVerifyCookie(orgSlug: string): Promise<string | null> {
  return (await cookies()).get(verifyCookieName(orgSlug))?.value ?? null;
}

export async function setVerifyCookie(orgSlug: string, rawToken: string): Promise<void> {
  (await cookies()).set(verifyCookieName(orgSlug), rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isSecureRequest(),
    path: '/',
    // Outlives the code, so an expired code still knows whose new one to send.
    maxAge: 24 * 60 * 60,
    // No `domain`: host-scoped like the session cookie (see session.ts).
  });
}

export async function clearVerifyCookie(orgSlug: string): Promise<void> {
  (await cookies()).set(verifyCookieName(orgSlug), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isSecureRequest(),
    path: '/',
    maxAge: 0,
  });
}

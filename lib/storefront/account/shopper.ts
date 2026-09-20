/*
 * lib/storefront/account/shopper.ts
 *
 * Everything that touches a shopper's record in the database.
 *
 * The account IS the merchant's `Customer` row (see the note on the model in
 * prisma/schema.prisma): a shopper who registers appears in the merchant's
 * Sales module immediately, and an order placed later needs no reconciling
 * against a second identity.
 *
 * Every function here takes an `organizationId` and scopes its query by it.
 * Accounts are per merchant — the same email may hold an account at two
 * stores, and neither may ever see the other. There is no query in this file
 * that finds a customer by email alone, and there must not be one.
 *
 * Nothing here decides policy about rate limits, redirects or wording; that
 * belongs to the callers in features/shop-account/actions.ts.
 */
import { createHash, randomBytes } from 'crypto';
import { compare, hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signSessionToken, type Shopper } from './session';

const BCRYPT_COST = 12;
export const RESET_TOKEN_TTL_MINUTES = 30;

/** The store a request belongs to, with what the auth flows need from it. */
export interface StoreRecord {
  id: string;
  name: string;
  slug: string;
  customStoreDomain: string | null;
}

export async function findStoreBySlug(slug: string): Promise<StoreRecord | null> {
  if (!slug) return null;
  return prisma.organization.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: { id: true, name: true, slug: true, customStoreDomain: true },
  });
}

/** Emails are compared lower-cased and trimmed, everywhere, without exception. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/* ---------------- accounts ---------------- */

interface CustomerAuthRow {
  id: string;
  organizationId: string;
  email: string | null;
  name: string;
  phone: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  sessionVersion: number;
  status: string;
}

const AUTH_SELECT = {
  id: true,
  organizationId: true,
  email: true,
  name: true,
  phone: true,
  passwordHash: true,
  emailVerifiedAt: true,
  sessionVersion: true,
  status: true,
} as const;

async function findByEmail(organizationId: string, email: string): Promise<CustomerAuthRow | null> {
  return prisma.customer.findUnique({
    where: { organizationId_email: { organizationId, email: normalizeEmail(email) } },
    select: AUTH_SELECT,
  });
}

export type RegisterResult =
  | { ok: true; customer: CustomerAuthRow }
  | { ok: false; reason: 'email-taken' };

/**
 * Create the account, or claim a passwordless one.
 *
 * A merchant's staff may already have typed this person in as a customer
 * (an invoice, a walk-in). That row has no password, so registering with the
 * same address ATTACHES the login to it rather than creating a second
 * customer the merchant would have to merge by hand later.
 *
 * The claim is not treated as proof of the address: `emailVerifiedAt` stays
 * null for a credentials registration. When order history lands it must
 * check that flag before showing a claimed record's past orders.
 */
export async function registerShopper(input: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  phone?: string | null;
}): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hash(input.password, BCRYPT_COST);

  const existing = await findByEmail(input.organizationId, email);

  if (existing?.passwordHash) return { ok: false, reason: 'email-taken' };

  if (existing) {
    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: input.name.trim() || existing.name,
        phone: input.phone?.trim() || existing.phone,
        status: 'ACTIVE',
      },
      select: AUTH_SELECT,
    });
    return { ok: true, customer };
  }

  const customer = await prisma.customer.create({
    data: {
      organizationId: input.organizationId,
      name: input.name.trim(),
      email,
      phone: input.phone?.trim() || null,
      passwordHash,
    },
    select: AUTH_SELECT,
  });

  return { ok: true, customer };
}

/**
 * Check an email and password.
 *
 * Returns null for "no such account", "no password on this account" and
 * "wrong password" alike — the caller says one thing for all three, because
 * telling a stranger which addresses have accounts at this store is telling
 * them something that isn't theirs to know.
 *
 * A hash is compared even when no account was found, so the two paths take
 * a similar amount of time and the response can't be used to enumerate
 * addresses.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKxGhuaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export async function verifyShopperCredentials(input: {
  organizationId: string;
  email: string;
  password: string;
}): Promise<CustomerAuthRow | null> {
  const customer = await findByEmail(input.organizationId, input.email);

  const ok = await compare(input.password, customer?.passwordHash ?? DUMMY_HASH);

  if (!customer || !customer.passwordHash || !ok) return null;
  if (customer.status !== 'ACTIVE') return null;

  return customer;
}

/**
 * Sign in with Google: find the linked account, else the one with that
 * address, else create it.
 *
 * Google has verified the address, so linking by email is safe here in a way
 * it would not be for an unverified provider — and it is what makes "I made
 * my account with a password, now I'm clicking the Google button" work
 * rather than fail with "email already taken".
 */
export async function upsertShopperFromGoogle(input: {
  organizationId: string;
  googleSub: string;
  email: string;
  name: string;
  emailVerified: boolean;
}): Promise<CustomerAuthRow> {
  const email = normalizeEmail(input.email);

  const link = await prisma.customerOAuthAccount.findUnique({
    where: {
      organizationId_provider_providerAccountId: {
        organizationId: input.organizationId,
        provider: 'google',
        providerAccountId: input.googleSub,
      },
    },
    select: { customer: { select: AUTH_SELECT } },
  });

  if (link?.customer) {
    return prisma.customer.update({
      where: { id: link.customer.id },
      data: { status: 'ACTIVE' },
      select: AUTH_SELECT,
    });
  }

  const existing = await findByEmail(input.organizationId, email);

  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: {
          name: existing.name || input.name,
          status: 'ACTIVE',
          emailVerifiedAt: input.emailVerified ? (existing.emailVerifiedAt ?? new Date()) : existing.emailVerifiedAt,
        },
        select: AUTH_SELECT,
      })
    : await prisma.customer.create({
        data: {
          organizationId: input.organizationId,
          name: input.name.trim() || email.split('@')[0],
          email,
          emailVerifiedAt: input.emailVerified ? new Date() : null,
        },
        select: AUTH_SELECT,
      });

  await prisma.customerOAuthAccount.create({
    data: {
      customerId: customer.id,
      organizationId: input.organizationId,
      provider: 'google',
      providerAccountId: input.googleSub,
    },
  });

  return customer;
}

/* ---------------- issuing a session ---------------- */

/**
 * Mint the session token for a customer and stamp the sign-in.
 *
 * Separate from setting the cookie (lib/storefront/account/session.ts):
 * credentials sign-in sets it directly, while the Google flow has to carry
 * the token across an origin first — same token either way.
 */
export async function issueSessionToken(
  slug: string,
  customer: Pick<CustomerAuthRow, 'id' | 'organizationId' | 'sessionVersion'>,
): Promise<string> {
  await prisma.customer.update({
    where: { id: customer.id },
    data: { lastLoginAt: new Date() },
  });

  return signSessionToken({
    customerId: customer.id,
    organizationId: customer.organizationId,
    slug,
    sessionVersion: customer.sessionVersion,
  });
}

export function toShopper(customer: CustomerAuthRow): Shopper {
  return {
    id: customer.id,
    organizationId: customer.organizationId,
    email: customer.email ?? '',
    name: customer.name,
    firstName: customer.name.trim().split(/\s+/)[0] || customer.name,
    phone: customer.phone,
    hasPassword: Boolean(customer.passwordHash),
    emailVerified: Boolean(customer.emailVerifiedAt),
  };
}

/* ---------------- password reset ---------------- */

/**
 * Issue a reset token, or don't — the caller can't tell which, and neither
 * can the person who asked. Returns the raw token only when one was created;
 * only its hash is ever stored.
 */
export async function createPasswordResetToken(input: {
  organizationId: string;
  email: string;
}): Promise<{ rawToken: string; customer: CustomerAuthRow } | null> {
  const customer = await findByEmail(input.organizationId, input.email);
  if (!customer || customer.status !== 'ACTIVE' || !customer.email) return null;

  // Don't issue a second token (and second email) within a minute of the
  // last one — a per-account cooldown that survives a restart, unlike the
  // in-memory limiter the action also applies.
  const recent = await prisma.customerPasswordResetToken.findFirst({
    where: { customerId: customer.id, usedAt: null, createdAt: { gt: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (recent) return null;

  const rawToken = randomBytes(32).toString('base64url');

  await prisma.$transaction([
    prisma.customerPasswordResetToken.deleteMany({ where: { customerId: customer.id } }),
    prisma.customerPasswordResetToken.create({
      data: {
        customerId: customer.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  return { rawToken, customer };
}

export type ResetResult =
  | { ok: true; customer: CustomerAuthRow }
  | { ok: false; reason: 'invalid-token' };

/**
 * Spend a reset token and set the new password.
 *
 * Bumps `sessionVersion`, which invalidates every session issued before now
 * — including the one held by whoever might have been in the account. That
 * is the point of a reset, and it is why the token is single-use and the
 * whole thing happens in one transaction.
 */
export async function resetPasswordWithToken(input: {
  organizationId: string;
  rawToken: string;
  newPassword: string;
}): Promise<ResetResult> {
  const record = await prisma.customerPasswordResetToken.findUnique({
    where: { tokenHash: hashToken(input.rawToken) },
    select: {
      id: true,
      usedAt: true,
      expiresAt: true,
      customer: { select: AUTH_SELECT },
    },
  });

  if (
    !record ||
    record.usedAt ||
    record.expiresAt < new Date() ||
    record.customer.organizationId !== input.organizationId ||
    record.customer.status !== 'ACTIVE'
  ) {
    return { ok: false, reason: 'invalid-token' };
  }

  const passwordHash = await hash(input.newPassword, BCRYPT_COST);

  const [, , customer] = await prisma.$transaction([
    prisma.customerPasswordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Recovering the account also cancels any email change someone had
    // pending on it — see the note in ./profile.ts.
    prisma.customerEmailChange.deleteMany({ where: { customerId: record.customer.id } }),
    prisma.customer.update({
      where: { id: record.customer.id },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
        // Only the holder of that inbox could have followed the link, so the
        // reset doubles as proof of the address.
        emailVerifiedAt: record.customer.emailVerifiedAt ?? new Date(),
      },
      select: AUTH_SELECT,
    }),
  ]);

  return { ok: true, customer };
}

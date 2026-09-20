/*
 * lib/storefront/account/email-change.ts
 *
 * Changing the address an account signs in with — in two steps, on purpose.
 *
 *   request  → password checked, address taken?, token minted, two emails
 *              sent: a confirmation link to the NEW address and a notice to
 *              the OLD one. The account still signs in with its old address.
 *   confirm  → the link is opened, so the new inbox is proved. Only now does
 *              `Customer.email` move, marked verified, with every other
 *              session retired.
 *
 * WHY NOT ONE STEP. The address on an account is the address that recovers
 * it. Applying a change the moment it is typed means one transposed letter
 * hands account recovery to whoever happens to own the address that was
 * typed — silently, at the moment nobody is watching. Waiting for proof
 * costs a shopper one click and removes that whole class of accident.
 *
 * WHY THE OLD ADDRESS IS TOLD. It is the only warning an account holder gets
 * if someone else is doing this. It names the new address and says what to
 * do, and it is sent at REQUEST time — a notice that arrives only after the
 * change is complete is a notice that arrives too late to help.
 *
 * Uniqueness is checked twice, at request and again at confirm: the two
 * moments can be days apart, and in between somebody else may have taken the
 * address at this store.
 */
import { createHash, randomBytes } from 'crypto';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from './shopper';

export const EMAIL_CHANGE_TTL_MINUTES = 60;

interface CustomerRow {
  id: string;
  organizationId: string;
  email: string | null;
  name: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  sessionVersion: number;
  status: string;
}

const SELECT = {
  id: true,
  organizationId: true,
  email: true,
  name: true,
  passwordHash: true,
  emailVerifiedAt: true,
  sessionVersion: true,
  status: true,
} as const;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/* ---------------- step 1: request ---------------- */

export type RequestEmailChangeResult =
  | {
      ok: true;
      rawToken: string;
      newEmail: string;
      /** where the "was this you?" notice goes; null for a record with no address yet */
      previousEmail: string | null;
      customerName: string;
    }
  | { ok: false; reason: 'wrong-password' | 'email-taken' | 'no-password' | 'same-email' | 'not-found' };

export async function requestEmailChange(input: {
  organizationId: string;
  customerId: string;
  newEmail: string;
  currentPassword: string;
}): Promise<RequestEmailChangeResult> {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
    select: SELECT,
  });

  if (!customer) return { ok: false, reason: 'not-found' };

  // A Google-only account's address is Google's; letting it drift would leave
  // the shopper either locked out or looking at someone else's record.
  if (!customer.passwordHash) return { ok: false, reason: 'no-password' };

  const ok = await compare(input.currentPassword, customer.passwordHash);
  if (!ok) return { ok: false, reason: 'wrong-password' };

  const newEmail = normalizeEmail(input.newEmail);
  if (newEmail === customer.email) return { ok: false, reason: 'same-email' };

  const taken = await prisma.customer.findUnique({
    where: { organizationId_email: { organizationId: input.organizationId, email: newEmail } },
    select: { id: true },
  });
  if (taken) return { ok: false, reason: 'email-taken' };

  const rawToken = randomBytes(32).toString('base64url');

  await prisma.$transaction([
    // One pending change at a time: asking again replaces the last request,
    // so an abandoned typo can't be confirmed later by accident.
    prisma.customerEmailChange.deleteMany({ where: { customerId: customer.id } }),
    prisma.customerEmailChange.create({
      data: {
        customerId: customer.id,
        newEmail,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  return {
    ok: true,
    rawToken,
    newEmail,
    previousEmail: customer.email,
    customerName: customer.name,
  };
}

/** What the profile page shows while a change is waiting to be confirmed. */
export async function getPendingEmailChange(
  organizationId: string,
  customerId: string,
): Promise<{ newEmail: string; expiresAt: Date } | null> {
  const pending = await prisma.customerEmailChange.findFirst({
    where: {
      customerId,
      usedAt: null,
      expiresAt: { gt: new Date() },
      customer: { organizationId },
    },
    orderBy: { createdAt: 'desc' },
    select: { newEmail: true, expiresAt: true },
  });

  return pending;
}

/* ---------------- step 2: confirm ---------------- */

export type ConfirmEmailChangeResult =
  | { ok: true; customer: CustomerRow; previousEmail: string | null }
  | { ok: false; reason: 'invalid-token' | 'email-taken' };

/**
 * Spend the link and move the address.
 *
 * The token is claimed with a conditional update — the same compare-and-set
 * the Google handoff uses — so a link opened twice (a mail client prefetch,
 * a double tap) applies the change once.
 */
export async function confirmEmailChange(input: {
  organizationId: string;
  rawToken: string;
}): Promise<ConfirmEmailChangeResult> {
  const record = await prisma.customerEmailChange.findUnique({
    where: { tokenHash: hashToken(input.rawToken) },
    select: {
      id: true,
      newEmail: true,
      usedAt: true,
      expiresAt: true,
      customer: { select: SELECT },
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

  // Days may have passed since the request.
  const taken = await prisma.customer.findUnique({
    where: { organizationId_email: { organizationId: input.organizationId, email: record.newEmail } },
    select: { id: true },
  });
  if (taken && taken.id !== record.customer.id) return { ok: false, reason: 'email-taken' };

  const claimed = await prisma.customerEmailChange.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'invalid-token' };

  const previousEmail = record.customer.email;

  const customer = await prisma.customer.update({
    where: { id: record.customer.id },
    data: {
      email: record.newEmail,
      // Opening the link IS the proof, so the new address lands verified.
      emailVerifiedAt: new Date(),
      // Retires every session issued before the address moved.
      sessionVersion: { increment: 1 },
    },
    select: SELECT,
  });

  return { ok: true, customer, previousEmail };
}

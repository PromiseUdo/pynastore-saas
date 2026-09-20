/*
 * lib/storefront/account/profile.ts
 *
 * What a signed-in shopper may change about themselves.
 *
 * Same rules as ./shopper.ts: every function is scoped to one organization,
 * and none of them finds a customer by id alone — an id from a session is
 * still an id that has to be proved against the store it came from.
 *
 * The delicate ones are password and email, because both decide who can sign
 * in tomorrow:
 *   - changing a password requires the current one, even though the person is
 *     already signed in. A borrowed unlocked phone should not be able to lock
 *     the owner out of their own account.
 *   - changing an email requires the password too, and then waits for the new
 *     inbox to be proved before it takes effect — see ./email-change.ts.
 * Both bump `sessionVersion`, which kills every other session — the caller is
 * responsible for re-issuing the current one so the person doing the changing
 * isn't signed out by their own success.
 */
import { compare, hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from './shopper';

const BCRYPT_COST = 12;

export interface ProfileCustomer {
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

const SELECT = {
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

async function findOwn(organizationId: string, customerId: string): Promise<ProfileCustomer | null> {
  return prisma.customer.findFirst({
    where: { id: customerId, organizationId, status: 'ACTIVE' },
    select: SELECT,
  });
}

/** How this person signs in — what the profile page shows, and gates on. */
export interface SignInMethods {
  hasPassword: boolean;
  google: boolean;
}

export async function getSignInMethods(
  organizationId: string,
  customerId: string,
): Promise<SignInMethods> {
  const [customer, google] = await Promise.all([
    findOwn(organizationId, customerId),
    prisma.customerOAuthAccount.findFirst({
      where: { customerId, organizationId, provider: 'google' },
      select: { id: true },
    }),
  ]);

  return { hasPassword: Boolean(customer?.passwordHash), google: Boolean(google) };
}

/* ---------------- name and phone ---------------- */

export async function updateProfile(input: {
  organizationId: string;
  customerId: string;
  name: string;
  phone: string | null;
}): Promise<ProfileCustomer | null> {
  const customer = await findOwn(input.organizationId, input.customerId);
  if (!customer) return null;

  return prisma.customer.update({
    where: { id: customer.id },
    data: { name: input.name.trim(), phone: input.phone?.trim() || null },
    select: SELECT,
  });
}

/* ---------------- password ---------------- */

export type PasswordResult =
  | { ok: true; customer: ProfileCustomer }
  | { ok: false; reason: 'wrong-password' | 'not-found' };

/**
 * Change a password the shopper already has, or set the first one on an
 * account that signs in with Google.
 *
 * `currentPassword` is required in the first case and ignored in the second:
 * there is nothing to prove against on an account that has never had one,
 * and the person is already holding a valid session for it.
 */
export async function setPassword(input: {
  organizationId: string;
  customerId: string;
  currentPassword?: string;
  newPassword: string;
}): Promise<PasswordResult> {
  const customer = await findOwn(input.organizationId, input.customerId);
  if (!customer) return { ok: false, reason: 'not-found' };

  if (customer.passwordHash) {
    const ok = input.currentPassword
      ? await compare(input.currentPassword, customer.passwordHash)
      : false;
    if (!ok) return { ok: false, reason: 'wrong-password' };
  }

  const passwordHash = await hash(input.newPassword, BCRYPT_COST);

  const [, updated] = await prisma.$transaction([
    /*
     * Cancel any pending email change.
     *
     * This is what the notice sent to the old address promises: "someone
     * knows your password — change it, and that cancels the pending change".
     * Taking back control of the password has to take back control of where
     * the account is heading, or that advice is worthless.
     */
    prisma.customerEmailChange.deleteMany({ where: { customerId: customer.id } }),
    prisma.customer.update({
      where: { id: customer.id },
      data: {
        passwordHash,
        // Everything issued before this moment stops working.
        sessionVersion: { increment: 1 },
      },
      select: SELECT,
    }),
  ]);

  return { ok: true, customer: updated };
}

/* ---------------- email ---------------- */

/*
 * Changing the sign-in address is a TWO-STEP act and lives in its own file
 * (./email-change.ts): the account keeps its current address until the
 * person proves they can read the new inbox. Nothing here writes
 * `Customer.email` — if it did, a typo would move an account's recovery to
 * an address its owner cannot read.
 */

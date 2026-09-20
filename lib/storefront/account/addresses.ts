/*
 * lib/storefront/account/addresses.ts
 *
 * The shopper's address book.
 *
 * Rows are `CustomerAddress`; callers get the storefront's own `Address`
 * shape (lib/storefront/types.ts), which is what checkout's converters
 * already speak (`fromStoredAddress` / `toStoredAddress` in
 * lib/storefront/checkout/address.ts). Nothing outside this file maps those
 * fields by hand.
 *
 * Every query is scoped through the customer AND the organization, the same
 * rule as the rest of this folder: an address id from a form is a number a
 * stranger can also type, so "does this belong to you, at this store?" is
 * part of the WHERE clause rather than a check someone might forget.
 *
 * EXACTLY ONE DEFAULT, always. The first address saved becomes it, a new
 * default demotes the old one in the same transaction, and deleting the
 * default promotes the next most recently used. A shopper should never
 * reach checkout and find nothing preselected, or two things preselected.
 */
import { prisma } from '@/lib/prisma';
import type { Address } from '../types';

/** Generous for a person, low enough that nobody can fill a table with junk. */
export const MAX_ADDRESSES = 20;

type Row = {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  isDefault: boolean;
};

const SELECT = {
  id: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  isDefault: true,
} as const;

function toAddress(row: Row): Address {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2 ?? undefined,
    city: row.city,
    state: row.state,
    country: row.country,
    postalCode: row.postalCode ?? undefined,
    isDefault: row.isDefault,
  };
}

/** Scope shared by every function here. */
export interface AddressScope {
  organizationId: string;
  customerId: string;
}

/** Default first, then most recently updated. The order checkout shows them in. */
export async function listAddresses(scope: AddressScope): Promise<Address[]> {
  const rows = await prisma.customerAddress.findMany({
    where: { customerId: scope.customerId, customer: { organizationId: scope.organizationId } },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    select: SELECT,
  });
  return rows.map(toAddress);
}

export async function getAddress(scope: AddressScope, id: string): Promise<Address | null> {
  const row = await prisma.customerAddress.findFirst({
    where: { id, customerId: scope.customerId, customer: { organizationId: scope.organizationId } },
    select: SELECT,
  });
  return row ? toAddress(row) : null;
}

/** The one checkout preselects. */
export async function getDefaultAddress(scope: AddressScope): Promise<Address | null> {
  const [first] = await listAddresses(scope);
  return first ?? null;
}

export type AddressInput = Omit<Address, 'id' | 'isDefault'> & { isDefault?: boolean };

export type SaveAddressResult =
  | { ok: true; address: Address }
  | { ok: false; reason: 'too-many' | 'not-found' };

export async function createAddress(
  scope: AddressScope,
  input: AddressInput,
): Promise<SaveAddressResult> {
  const existing = await prisma.customerAddress.count({
    where: { customerId: scope.customerId, customer: { organizationId: scope.organizationId } },
  });

  if (existing >= MAX_ADDRESSES) return { ok: false, reason: 'too-many' };

  // The first address is the default whether or not anyone asked, so there
  // is always exactly one.
  const makeDefault = input.isDefault || existing === 0;

  const [, created] = await prisma.$transaction([
    prisma.customerAddress.updateMany({
      where: makeDefault ? { customerId: scope.customerId, isDefault: true } : { id: '' },
      data: { isDefault: false },
    }),
    prisma.customerAddress.create({
      data: {
        customerId: scope.customerId,
        fullName: input.fullName,
        phone: input.phone,
        line1: input.line1,
        line2: input.line2 || null,
        city: input.city,
        state: input.state,
        country: input.country,
        postalCode: input.postalCode || null,
        isDefault: makeDefault,
      },
      select: SELECT,
    }),
  ]);

  return { ok: true, address: toAddress(created) };
}

export async function updateAddress(
  scope: AddressScope,
  id: string,
  input: AddressInput,
): Promise<SaveAddressResult> {
  const owned = await getAddress(scope, id);
  if (!owned) return { ok: false, reason: 'not-found' };

  // An address cannot un-default itself: something has to be the default, so
  // the way to move it is to make another one default.
  const makeDefault = input.isDefault || owned.isDefault === true;

  const [, updated] = await prisma.$transaction([
    prisma.customerAddress.updateMany({
      where: makeDefault
        ? { customerId: scope.customerId, isDefault: true, NOT: { id } }
        : { id: '' },
      data: { isDefault: false },
    }),
    prisma.customerAddress.update({
      where: { id },
      data: {
        fullName: input.fullName,
        phone: input.phone,
        line1: input.line1,
        line2: input.line2 || null,
        city: input.city,
        state: input.state,
        country: input.country,
        postalCode: input.postalCode || null,
        isDefault: makeDefault,
      },
      select: SELECT,
    }),
  ]);

  return { ok: true, address: toAddress(updated) };
}

export async function setDefaultAddress(scope: AddressScope, id: string): Promise<boolean> {
  const owned = await getAddress(scope, id);
  if (!owned) return false;

  await prisma.$transaction([
    prisma.customerAddress.updateMany({
      where: { customerId: scope.customerId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.customerAddress.update({ where: { id }, data: { isDefault: true } }),
  ]);

  return true;
}

/**
 * Delete, then make sure a default survives.
 *
 * Removing the default would otherwise leave a book where nothing is
 * preselected — checkout would open with an empty form for a shopper who
 * has three addresses saved.
 */
export async function deleteAddress(scope: AddressScope, id: string): Promise<boolean> {
  const owned = await getAddress(scope, id);
  if (!owned) return false;

  await prisma.customerAddress.delete({ where: { id } });

  if (owned.isDefault) {
    const next = await prisma.customerAddress.findFirst({
      where: { customerId: scope.customerId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (next) {
      await prisma.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  return true;
}

/**
 * Save an address typed at checkout, unless the shopper already has it.
 *
 * "Already has it" is judged on the parts that decide where a parcel goes —
 * not on the label or the casing — so ticking the box at every checkout
 * doesn't slowly fill the book with the same house five times.
 */
export async function saveAddressIfNew(
  scope: AddressScope,
  input: AddressInput,
): Promise<SaveAddressResult | { ok: true; address: Address; existing: true }> {
  const fingerprint = (a: Pick<Address, 'line1' | 'line2' | 'city' | 'state' | 'postalCode'>) =>
    [a.line1, a.line2 ?? '', a.city, a.state, a.postalCode ?? '']
      .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
      .join('|');

  const existing = await listAddresses(scope);
  const match = existing.find((a) => fingerprint(a) === fingerprint(input));
  if (match) return { ok: true, address: match, existing: true };

  return createAddress(scope, input);
}

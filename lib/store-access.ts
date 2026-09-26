// lib/store-access.ts
//
// Where a member may work (ROADMAP Phase 8.6).
//
// A role says WHAT someone may do; this says WHERE. The two are separate
// because they answer different questions: a warehouse manager in Lagos and
// one in Port Harcourt hold the same permissions and must not be able to
// change each other's shelves.
//
// THE RULE, and the reason it is this way round: **no stores listed means
// every store**. That is the only default that leaves an existing workspace
// exactly as it was when the table landed, and it means forgetting to pick
// stores for a new member can never lock them out of their own shop. A member
// is scoped only once somebody deliberately picks stores for them.
//
// This is enforced on WRITES — anything that moves, counts or reassigns stock
// at a named store. Reads stay open: a clerk seeing that Port Harcourt has
// three left is how they tell a customer where to go, and hiding it would
// make the transfer screen unusable.
//
// Plain module, no 'use server': pure functions over the org context.

/** The membership shape this module needs — a subset of OrganizationContext. */
export type StoreScopedMembership = {
  /** Stores this member is limited to. Empty or absent = every store. */
  warehouseIds?: string[];
};

/** Thrown when a member names a store they may not work in. */
export class StoreAccessDeniedError extends Error {
  constructor(storeName?: string) {
    super(
      storeName
        ? `You don't have access to ${storeName}. Ask an admin to add it to your stores.`
        : "You don't have access to that store. Ask an admin to add it to your stores.",
    );
    this.name = 'StoreAccessDeniedError';
  }
}

/**
 * The stores this member is limited to, or `null` for every store.
 * `null` is the answer for most members, and callers must handle it — an
 * empty array would read as "no stores at all", which is the opposite.
 */
export function allowedStoreIds(membership: StoreScopedMembership): string[] | null {
  const ids = membership.warehouseIds ?? [];
  return ids.length === 0 ? null : ids;
}

/** Whether this member may work in one store. */
export function canUseStore(membership: StoreScopedMembership, warehouseId: string): boolean {
  const allowed = allowedStoreIds(membership);
  return allowed === null || allowed.includes(warehouseId);
}

/**
 * Gate a write that names a store. Throws `StoreAccessDeniedError`, which the
 * feature modules' `toActionError` turns into the message above — so a scoped
 * member is told what to do about it rather than seeing a failure.
 */
export function requireStoreAccess(
  membership: StoreScopedMembership,
  warehouseId: string,
  storeName?: string,
): void {
  if (!canUseStore(membership, warehouseId)) throw new StoreAccessDeniedError(storeName);
}

/**
 * A Prisma `where` fragment limiting a warehouse query to this member's
 * stores — `{}` when they have every one, so it composes with any other
 * filter.
 */
export function storeScopeWhere(membership: StoreScopedMembership): { id?: { in: string[] } } {
  const allowed = allowedStoreIds(membership);
  return allowed === null ? {} : { id: { in: allowed } };
}

/** "All stores", or the names, for a member row in Settings → Members. */
export function describeStoreAccess(storeNames: string[]): string {
  return storeNames.length === 0 ? 'All stores' : storeNames.join(', ');
}

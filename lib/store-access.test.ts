import { describe, expect, it } from 'vitest';
import {
  allowedStoreIds,
  canUseStore,
  describeStoreAccess,
  requireStoreAccess,
  storeScopeWhere,
  StoreAccessDeniedError,
} from './store-access';

/*
 * The rule these pin down is the one the whole of Phase 8.6 rests on: NO
 * STORES LISTED MEANS EVERY STORE. Get it the wrong way round and an upgrade
 * locks every member out of every shelf, so it is asserted from both ends —
 * including the shape an older context (no field at all) arrives in.
 */
describe('no stores listed means every store', () => {
  it('treats an empty list, and a context without the field, as every store', () => {
    expect(allowedStoreIds({ warehouseIds: [] })).toBeNull();
    expect(allowedStoreIds({})).toBeNull();
    expect(canUseStore({ warehouseIds: [] }, 'anything')).toBe(true);
    expect(canUseStore({}, 'anything')).toBe(true);
    expect(storeScopeWhere({ warehouseIds: [] })).toEqual({});
  });

  it('limits a scoped member to their own stores', () => {
    const member = { warehouseIds: ['lagos'] };
    expect(allowedStoreIds(member)).toEqual(['lagos']);
    expect(canUseStore(member, 'lagos')).toBe(true);
    expect(canUseStore(member, 'port-harcourt')).toBe(false);
    expect(storeScopeWhere(member)).toEqual({ id: { in: ['lagos'] } });
  });
});

describe('requireStoreAccess', () => {
  it('says nothing for a store the member may use', () => {
    expect(() => requireStoreAccess({ warehouseIds: ['lagos'] }, 'lagos')).not.toThrow();
    expect(() => requireStoreAccess({}, 'lagos')).not.toThrow();
  });

  it('throws a named error whose message names the store and the way out', () => {
    try {
      requireStoreAccess({ warehouseIds: ['lagos'] }, 'ph', 'Port Harcourt');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreAccessDeniedError);
      // The name is what features/*/shared.ts matches on to pass the message through.
      expect((error as Error).name).toBe('StoreAccessDeniedError');
      expect((error as Error).message).toContain('Port Harcourt');
      expect((error as Error).message).toContain('Ask an admin');
    }
  });

  it('still says something useful when the store’s name isn’t to hand', () => {
    expect(() => requireStoreAccess({ warehouseIds: ['lagos'] }, 'ph')).toThrow(/that store/);
  });
});

describe('describeStoreAccess', () => {
  it('reads "All stores" for nobody in particular, and names them otherwise', () => {
    expect(describeStoreAccess([])).toBe('All stores');
    expect(describeStoreAccess(['Lagos'])).toBe('Lagos');
    expect(describeStoreAccess(['Lagos', 'Port Harcourt'])).toBe('Lagos, Port Harcourt');
  });
});

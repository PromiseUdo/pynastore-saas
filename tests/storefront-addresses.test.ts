/*
 * The shopper's address book, against the real database.
 *
 * Two invariants carry the whole feature: an address belongs to exactly one
 * customer at one store, and there is always exactly one default. Everything
 * checkout does — preselecting, prefilling, saving what was typed — rests on
 * those two being true after every operation, including deletion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { registerShopper } from '@/lib/storefront/account/shopper';
import {
  MAX_ADDRESSES,
  createAddress,
  deleteAddress,
  getAddress,
  getDefaultAddress,
  listAddresses,
  saveAddressIfNew,
  setDefaultAddress,
  updateAddress,
} from '@/lib/storefront/account/addresses';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-addr-${suffix}` };
const other = { id: '', slug: `__test-addr-other-${suffix}` };

let scope = { organizationId: '', customerId: '' };
let strangerScope = { organizationId: '', customerId: '' };

const LAGOS = {
  fullName: 'Ada Okoro',
  phone: '+234 801 234 5678',
  line1: '14 Admiralty Way',
  line2: 'Lekki Phase 1',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  postalCode: '106104',
};

const PORT_HARCOURT = {
  fullName: 'Ada Okoro',
  phone: '+234 802 000 0000',
  line1: '3 Trans Amadi Road',
  city: 'Port Harcourt',
  state: 'Rivers',
  country: 'Nigeria',
};

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Addr Store', slug: store.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug } })).id;

  const mine = await registerShopper({
    organizationId: store.id, name: 'Ada Okoro', email: `ada-${suffix}@example.com`, password: 'a password here',
  });
  const stranger = await registerShopper({
    organizationId: other.id, name: 'Someone Else', email: `zed-${suffix}@example.com`, password: 'a password here',
  });
  if (!mine.ok || !stranger.ok) throw new Error('setup failed');

  scope = { organizationId: store.id, customerId: mine.customer.id };
  strangerScope = { organizationId: other.id, customerId: stranger.customer.id };
});

afterAll(async () => {
  for (const org of [store, other]) {
    await prisma.customerAddress.deleteMany({ where: { customer: { organizationId: org.id } } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('the first address', () => {
  it('becomes the default whether or not anyone asked', async () => {
    const result = await createAddress(scope, LAGOS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address.isDefault).toBe(true);
    await expect(getDefaultAddress(scope)).resolves.toMatchObject({ line1: LAGOS.line1 });
  });
});

describe('more than one', () => {
  it('leaves the existing default alone unless asked', async () => {
    const added = await createAddress(scope, PORT_HARCOURT);
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    expect(added.address.isDefault).toBe(false);
    await expect(getDefaultAddress(scope)).resolves.toMatchObject({ line1: LAGOS.line1 });
  });

  it('moves the default, leaving exactly one', async () => {
    const [, second] = await listAddresses(scope);
    await expect(setDefaultAddress(scope, second.id)).resolves.toBe(true);

    const all = await listAddresses(scope);
    expect(all.filter((a) => a.isDefault)).toHaveLength(1);
    expect(all[0].id).toBe(second.id); // default is listed first
  });

  it('lists the default first, which is the one checkout preselects', async () => {
    const [first] = await listAddresses(scope);
    expect(first.isDefault).toBe(true);
  });

  it('makes a new address default on request, demoting the old one', async () => {
    const added = await createAddress(scope, {
      ...LAGOS,
      line1: '1 Default Street',
      isDefault: true,
    });
    expect(added.ok).toBe(true);

    const all = await listAddresses(scope);
    expect(all.filter((a) => a.isDefault)).toHaveLength(1);
    expect(all[0].line1).toBe('1 Default Street');
  });
});

describe('editing', () => {
  it('saves the change and keeps the default flag', async () => {
    const [current] = await listAddresses(scope);
    const result = await updateAddress(scope, current.id, {
      ...LAGOS,
      line1: '1 Default Street',
      city: 'Ikeja',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address.city).toBe('Ikeja');
    expect(result.address.isDefault).toBe(true);
  });

  it('refuses an address belonging to another store’s shopper', async () => {
    const [mine] = await listAddresses(scope);

    await expect(getAddress(strangerScope, mine.id)).resolves.toBeNull();
    await expect(updateAddress(strangerScope, mine.id, PORT_HARCOURT)).resolves.toEqual({
      ok: false,
      reason: 'not-found',
    });
    await expect(setDefaultAddress(strangerScope, mine.id)).resolves.toBe(false);
    await expect(deleteAddress(strangerScope, mine.id)).resolves.toBe(false);

    // ...and none of those attempts changed anything.
    await expect(getAddress(scope, mine.id)).resolves.toMatchObject({ isDefault: true });
  });
});

describe('deleting', () => {
  it('promotes another address when the default goes', async () => {
    const before = await listAddresses(scope);
    const theDefault = before.find((a) => a.isDefault)!;

    await expect(deleteAddress(scope, theDefault.id)).resolves.toBe(true);

    const after = await listAddresses(scope);
    expect(after).toHaveLength(before.length - 1);
    expect(after.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('leaves an empty book when the last one goes, and checkout simply has nothing to preselect', async () => {
    for (const address of await listAddresses(scope)) {
      await deleteAddress(scope, address.id);
    }

    await expect(listAddresses(scope)).resolves.toEqual([]);
    await expect(getDefaultAddress(scope)).resolves.toBeNull();
  });
});

describe('saving what was typed at checkout', () => {
  it('saves it the first time', async () => {
    const result = await saveAddressIfNew(scope, LAGOS);
    expect(result.ok).toBe(true);
    await expect(listAddresses(scope)).resolves.toHaveLength(1);
  });

  it('does not save the same place again, however it was typed', async () => {
    const result = await saveAddressIfNew(scope, {
      ...LAGOS,
      line1: '  14  admiralty   way ',
      city: 'LAGOS',
    });

    expect(result.ok).toBe(true);
    expect('existing' in result && result.existing).toBe(true);
    await expect(listAddresses(scope)).resolves.toHaveLength(1);
  });

  it('does save a genuinely different one', async () => {
    await saveAddressIfNew(scope, PORT_HARCOURT);
    await expect(listAddresses(scope)).resolves.toHaveLength(2);
  });
});

describe('the cap', () => {
  it('stops a book from growing without limit', async () => {
    const existing = await listAddresses(scope);
    for (let i = existing.length; i < MAX_ADDRESSES; i += 1) {
      const result = await createAddress(scope, { ...PORT_HARCOURT, line1: `${i} Filler Street` });
      expect(result.ok).toBe(true);
    }

    await expect(createAddress(scope, { ...PORT_HARCOURT, line1: 'One Too Many' })).resolves.toEqual({
      ok: false,
      reason: 'too-many',
    });
  });
});

// @vitest-environment jsdom
/*
 * Reconciling a browser's saved list with an account's.
 *
 * Four rules, and the one that matters most is the merge: a shopper who
 * saved things as a guest and then signs in must not lose them. The others
 * exist so a shared device can't leak one person's saves to the next.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { WishlistSync } from './wishlist-sync';
import { StorefrontProvider, type StorefrontShopper } from '@/lib/storefront/context';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import { setActiveOrg } from '@/lib/storefront/stores/storage';

const mergeWishlistAction = vi.fn(async (ids: string[]) => ['server-1', ...ids]);
vi.mock('@/features/shop-account/wishlist-actions', () => ({
  mergeWishlistAction: (ids: string[]) => mergeWishlistAction(ids),
  saveToWishlistAction: vi.fn(async () => true),
  removeFromWishlistAction: vi.fn(async () => true),
}));

setActiveOrg('demo');

const ADA: StorefrontShopper = {
  id: 'cus_ada',
  name: 'Ada Okoro',
  firstName: 'Ada',
  email: 'ada@example.com',
};

function renderSync(
  shopper: StorefrontShopper | null,
  serverItems: { productId: string; slug: string }[],
) {
  return render(
    <StorefrontProvider
      org={{ slug: 'demo', name: 'Demo Store', logoUrl: null }}
      isMobileRuntime={false}
      shopper={shopper}
    >
      <WishlistSync serverItems={serverItems} />
    </StorefrontProvider>,
  );
}

const entry = (productId: string) => ({ productId, slug: productId, addedAt: Date.now() });

beforeEach(() => {
  mergeWishlistAction.mockClear();
  window.localStorage.clear();
  useWishlistStore.setState({ items: [], accountId: null, hydrated: true });
});

afterEach(cleanup);

describe('a guest', () => {
  it('is left alone — the browser is the list', async () => {
    useWishlistStore.setState({ items: [entry('local-1')], accountId: null, hydrated: true });

    renderSync(null, []);

    await waitFor(() => expect(mergeWishlistAction).not.toHaveBeenCalled());
    expect(useWishlistStore.getState().items.map((i) => i.productId)).toEqual(['local-1']);
  });
});

describe('signing in', () => {
  it('folds the browser saves into the account and keeps both', async () => {
    useWishlistStore.setState({ items: [entry('local-1')], accountId: null, hydrated: true });

    renderSync(ADA, [{ productId: 'server-1', slug: 'server-1' }]);

    await waitFor(() => expect(mergeWishlistAction).toHaveBeenCalledWith(['local-1']));
    await waitFor(() =>
      expect(useWishlistStore.getState().items.map((i) => i.productId)).toEqual([
        'server-1',
        'local-1',
      ]),
    );
    expect(useWishlistStore.getState().accountId).toBe(ADA.id);
  });

  it('adopts the account list when the browser had nothing to offer', async () => {
    renderSync(ADA, [
      { productId: 'server-1', slug: 'one' },
      { productId: 'server-2', slug: 'two' },
    ]);

    await waitFor(() =>
      expect(useWishlistStore.getState().items.map((i) => i.productId)).toEqual([
        'server-1',
        'server-2',
      ]),
    );
    // Nothing to merge means no round trip at all.
    expect(mergeWishlistAction).not.toHaveBeenCalled();
  });
});

describe('already signed in', () => {
  it('takes the server list as the truth, not the browser copy', async () => {
    useWishlistStore.setState({
      items: [entry('stale-1')],
      accountId: ADA.id,
      hydrated: true,
    });

    renderSync(ADA, [{ productId: 'server-1', slug: 'one' }]);

    await waitFor(() =>
      expect(useWishlistStore.getState().items.map((i) => i.productId)).toEqual(['server-1']),
    );
    // A signed-in shopper's list is never re-merged; that would resurrect
    // everything they have ever removed.
    expect(mergeWishlistAction).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('clears the saves, so the next person on this device sees none', async () => {
    useWishlistStore.setState({
      items: [entry('was-adas')],
      accountId: ADA.id,
      hydrated: true,
    });

    renderSync(null, []);

    await waitFor(() => expect(useWishlistStore.getState().items).toEqual([]));
    expect(useWishlistStore.getState().accountId).toBeNull();
  });
});

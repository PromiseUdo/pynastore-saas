// @vitest-environment jsdom
/*
 * A full page load evaluates store modules before the storefront provider has
 * stamped the tenant, so `persist` hydrates from the `default` namespace. This
 * pins the fix: stamping the org re-reads every store that hydrated under a
 * different namespace, so a refreshed bag (and the session's shopping events)
 * are still there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete window.__SF_ORG__;
});

describe('setActiveOrg', () => {
  it('re-reads stores that hydrated before the tenant was known', async () => {
    window.localStorage.setItem(
      'mansaas:sf:acme:recently-viewed',
      JSON.stringify({ state: { ids: ['prod_a', 'prod_b'] }, version: 0 }),
    );
    window.sessionStorage.setItem(
      'mansaas:sf:acme:shopping-activity',
      JSON.stringify({ state: { events: [{ name: 'product_searched', query: 'lamp', at: 1 }] }, version: 0 }),
    );

    // Module evaluation with no org stamped — the page-load race.
    const { useRecentlyViewedStore } = await import('./recently-viewed-store');
    const { useShoppingActivityStore } = await import('./shopping-activity-store');
    const { setActiveOrg } = await import('./storage');
    expect(useRecentlyViewedStore.getState().ids).toEqual([]);

    setActiveOrg('acme');

    expect(useRecentlyViewedStore.getState().ids).toEqual(['prod_a', 'prod_b']);
    expect(useShoppingActivityStore.getState().events).toHaveLength(1);
  });

  it('keeps tenants apart when the active org changes', async () => {
    window.localStorage.setItem('mansaas:sf:a:recently-viewed', JSON.stringify({ state: { ids: ['prod_a'] }, version: 0 }));
    window.localStorage.setItem('mansaas:sf:b:recently-viewed', JSON.stringify({ state: { ids: ['prod_b'] }, version: 0 }));

    const { useRecentlyViewedStore } = await import('./recently-viewed-store');
    const { setActiveOrg } = await import('./storage');

    setActiveOrg('a');
    expect(useRecentlyViewedStore.getState().ids).toEqual(['prod_a']);
    setActiveOrg('b');
    expect(useRecentlyViewedStore.getState().ids).toEqual(['prod_b']);
  });

  it('is a no-op when the org has not changed', async () => {
    const { useRecentlyViewedStore } = await import('./recently-viewed-store');
    const { setActiveOrg } = await import('./storage');
    setActiveOrg('acme');
    const rehydrate = vi.spyOn(useRecentlyViewedStore.persist, 'rehydrate');
    setActiveOrg('acme');
    expect(rehydrate).not.toHaveBeenCalled();
  });
});

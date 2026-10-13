/*
 * Switching shop on the business host (ROADMAP 19.1) writes that host's own
 * shop cookie as well as the session. Auth.js re-sends the session cookie on
 * every response, so a poll the old page had in flight could otherwise put
 * the session back to the old shop just after a switch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pinDomains, ROOT_DOMAIN } from './helpers/storefront-requests';

const state = vi.hoisted(() => ({ host: '', set: [] as { name: string; value: string; options: Record<string, unknown> }[] }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: state.host }),
  cookies: async () => ({ set: (name: string, value: string, options: Record<string, unknown>) => state.set.push({ name, value, options }) }),
}));
const updates = vi.hoisted(() => [] as unknown[]);
vi.mock('@/auth', () => ({ unstable_update: vi.fn(async (data: unknown) => updates.push(data)) }));

pinDomains();
const { updateCurrentOrganization } = await import('@/lib/session');
const { BUSINESS_SHOP_COOKIE } = await import('@/lib/tenant/business');

describe('switching shop', () => {
  beforeEach(() => {
    state.set = [];
    updates.length = 0;
  });

  it('on the business host, also remembers the shop in its own cookie', async () => {
    state.host = `b.${ROOT_DOMAIN}`;
    await updateCurrentOrganization('u1', 'org1', 'acme');
    expect(updates).toEqual([{ currentOrganizationId: 'org1', currentOrgSlug: 'acme' }]);
    expect(state.set).toEqual([
      { name: BUSINESS_SHOP_COOKIE, value: 'acme', options: expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }) },
    ]);
    // Host-only: never shared with the shops' own admin hosts.
    expect(state.set[0].options).not.toHaveProperty('domain');
  });

  it("elsewhere, changes only the session", async () => {
    state.host = `acme.${ROOT_DOMAIN}`;
    await updateCurrentOrganization('u1', 'org1', 'acme');
    expect(updates).toHaveLength(1);
    expect(state.set).toEqual([]);
  });
});

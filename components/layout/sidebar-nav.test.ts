// The admin menu's "you are here" rule (AGENTS §7a): the longest matching address wins.
import { describe, expect, it, vi } from 'vitest';

// The sidebar module pulls in client-only pieces; the rule itself needs none of them.
vi.mock('@/components/account/sign-out', () => ({ signOutHere: vi.fn() }));
vi.mock('@/components/business-app/no-buying', () => ({ UpgradeLink: () => null }));
vi.mock('@/components/org-switcher', () => ({ OrgSwitcher: () => null }));
vi.mock('@/lib/chat/inbox-client', () => ({ useInboxStore: () => 0 }));

const { activeChild, activeItem, buildNav } = await import('./sidebar');

const open = buildNav(true);
const closed = buildNav(false);
const at = (path: string, nav = open) => activeItem(nav, path)?.title ?? null;

describe('the admin menu', () => {
  it('lights up the entry that owns the page, across addresses', () => {
    expect(at('/dashboard')).toBe('Home');
    expect(at('/sales')).toBe('Orders');
    expect(at('/sales/orders/o1')).toBe('Orders');
    expect(at('/sales/payments')).toBe('Orders');
    expect(at('/sales/customers/c1')).toBe('Customers');
    expect(at('/sales/questions')).toBe('Customers');
    expect(at('/sales/quotes/new')).toBe('Invoices and quotes');
    expect(at('/sales/discounts')).toBe('Marketing');
    expect(at('/social/compose')).toBe('Marketing');
    expect(at('/inventory/products/p1')).toBe('Products');
    expect(at('/inventory/items/i1')).toBe('Products');
    expect(at('/inventory')).toBe('Inventory');
    expect(at('/inventory/warehouses/w1')).toBe('Inventory');
    expect(at('/inventory/reports/advanced')).toBe('Reports');
    expect(at('/procurement/purchase-orders/po1')).toBe('Purchasing');
    expect(at('/settings/pages/new')).toBe('Online store');
    expect(at('/settings/domain')).toBe('Online store');
    expect(at('/settings/payments/online')).toBe('Settings');
    expect(at('/settings')).toBe('Settings');
  });

  it('keeps personal pages out of it', () => {
    expect(at('/settings/account')).toBeNull();
    expect(at('/settings/notifications')).toBeNull();
    expect(at('/notifications')).toBeNull();
  });

  it('leads with the setup guide until the shop opens, then keeps it in Settings', () => {
    expect(closed[0].items.map((i) => i.title)).toEqual(['Home', 'Setup guide', 'Messages']);
    expect(at('/settings/setup', closed)).toBe('Setup guide');
    expect(open[0].items.map((i) => i.title)).toEqual(['Home', 'Messages']);
    expect(at('/settings/setup')).toBe('Settings');
  });

  it('picks the most specific child, so "Business details" is only /settings itself', () => {
    const settings = open.flatMap((g) => g.items).find((i) => i.title === 'Settings')!;
    expect(activeChild(settings, '/settings')).toBe('/settings');
    expect(activeChild(settings, '/settings/members/m1')).toBe('/settings/members');
    expect(activeChild(settings, '/settings/payments/online')).toBe('/settings/payments');
  });

  it('names every entry in sentence case', () => {
    for (const item of open.flatMap((g) => g.items)) {
      for (const title of [item.title, ...(item.children ?? []).map((c) => c.title)]) {
        expect(title.slice(1), title).toBe(title.slice(1).toLowerCase());
      }
    }
  });
});

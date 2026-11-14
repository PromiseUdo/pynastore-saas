'use client';

import { signOutHere } from '@/components/account/sign-out';
import { UpgradeLink } from '@/components/business-app/no-buying';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  House,
  ListChecks,
  ShoppingBag,
  Users,
  FileText,
  Tag,
  Package,
  ClipboardList,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Megaphone,
  ArrowUpCircle,
  Store,
  MessagesSquare,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OrgInfo, UserInfo } from './dashboard-layout';
import { OrgSwitcher, type OrgSwitcherItem } from '@/components/org-switcher';
import { Badge } from '@/components/ui/badge';
import { useInboxStore } from '@/lib/chat/inbox-client';

/* ─── Nav data ─────────────────────────────────────────────────────────── */

/*
 * Grouped by what a shop owner is doing, not by how the app is built: selling
 * first, then the catalogue and stock, then growing the shop, then settings.
 * Labels only — every address is unchanged, so bookmarks and emailed links
 * keep working. Every entry must lead to a real page (AGENTS §7).
 *
 * A group can hold pages from different addresses (Online store holds
 * /settings/domain), so which entry is "you are here" is decided by the
 * longest address that matches (`activeItem`), not by the parent's own href.
 */

type NavChild = { title: string; href: string };

type NavItem = {
  title: string;
  /** where the entry itself goes: the section's overview, or its first page */
  href: string;
  icon: React.ElementType;
  children?: NavChild[];
  /** more addresses that belong to this entry (its href and children's count already) */
  match?: string[];
  /** shows a live count next to the entry */
  count?: 'messages';
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const SETUP_GUIDE: NavChild = { title: 'Setup guide', href: '/settings/setup' };

/** Personal pages, reached from the account menu (header) — they light up no entry here. */
const ACCOUNT_PATHS = ['/settings/account', '/settings/notifications', '/notifications'];

export function buildNav(shopOpen: boolean): NavGroup[] {
  return [
    {
      items: [
        { title: 'Home', href: '/dashboard', icon: House },
        // Until the shop opens, getting it ready IS the job; afterwards it lives in Settings.
        ...(shopOpen ? [] : [{ ...SETUP_GUIDE, icon: ListChecks }]),
        { title: 'Messages', href: '/messages', icon: MessagesSquare, count: 'messages' as const },
      ],
    },
    {
      label: 'Sell',
      items: [
        {
          title: 'Orders',
          href: '/sales',
          icon: ShoppingBag,
          children: [
            { title: 'All orders', href: '/sales/orders' },
            { title: 'Packing and delivery', href: '/sales/fulfillment' },
            { title: 'Returns', href: '/sales/returns' },
            { title: 'Payouts', href: '/sales/payments' },
          ],
        },
        {
          title: 'Customers',
          href: '/sales/customers',
          icon: Users,
          children: [
            { title: 'All customers', href: '/sales/customers' },
            { title: 'Reviews', href: '/sales/reviews' },
            { title: 'Questions', href: '/sales/questions' },
          ],
        },
        {
          title: 'Invoices and quotes',
          href: '/sales/invoices',
          icon: FileText,
          children: [
            { title: 'Invoices', href: '/sales/invoices' },
            { title: 'Quotes', href: '/sales/quotes' },
          ],
        },
      ],
    },
    {
      label: 'Products and stock',
      items: [
        {
          title: 'Products',
          href: '/inventory/products',
          icon: Tag,
          children: [
            { title: 'All products', href: '/inventory/products' },
            { title: 'Categories', href: '/inventory/categories' },
            { title: 'Collections', href: '/inventory/collections' },
            { title: 'Brands', href: '/inventory/brands' },
          ],
          // A single stock item's page (/inventory/items/…) is a product's.
          match: ['/inventory/items'],
        },
        {
          title: 'Inventory',
          href: '/inventory',
          icon: Package,
          children: [
            { title: 'Stores', href: '/inventory/warehouses' },
            { title: 'Stock history', href: '/inventory/movements' },
            { title: 'Transfers', href: '/inventory/transfers' },
            { title: 'Stock counts', href: '/inventory/cycle-counts' },
            { title: 'Shelf locations', href: '/inventory/putaway' },
          ],
        },
        {
          title: 'Purchasing',
          href: '/procurement',
          icon: ClipboardList,
          children: [
            { title: 'Purchase orders', href: '/procurement/purchase-orders' },
            { title: 'Suppliers', href: '/procurement/suppliers' },
            { title: 'Reorder suggestions', href: '/procurement/reorder' },
          ],
        },
      ],
    },
    {
      label: 'Grow',
      items: [
        {
          title: 'Online store',
          href: '/online-store/customize',
          icon: Store,
          children: [
            { title: 'Design', href: '/online-store/customize' },
            { title: 'Pages', href: '/settings/pages' },
            { title: 'Domain', href: '/settings/domain' },
            { title: 'Search and sharing', href: '/settings/storefront' },
            { title: 'Mobile app', href: '/settings/mobile-app' },
          ],
          match: ['/online-store'],
        },
        {
          title: 'Marketing',
          href: '/marketing/campaigns',
          icon: Megaphone,
          children: [
            { title: 'Campaigns', href: '/marketing/campaigns' },
            { title: 'Discount codes', href: '/sales/discounts' },
            { title: 'Social posts', href: '/social' },
          ],
          match: ['/marketing'],
        },
        // The stock reports live under /inventory/reports; the hub links to them.
        { title: 'Reports', href: '/reports', icon: BarChart3, match: ['/inventory/reports'] },
      ],
    },
    {
      items: [
        {
          title: 'Settings',
          href: '/settings',
          icon: Settings,
          children: [
            { title: 'Business details', href: '/settings' },
            ...(shopOpen ? [SETUP_GUIDE] : []),
            { title: 'Payment setup', href: '/settings/payments' },
            { title: 'Delivery and returns', href: '/settings/delivery' },
            { title: 'Team', href: '/settings/members' },
            { title: 'Roles and permissions', href: '/settings/roles' },
            { title: 'Activity log', href: '/settings/activity' },
            { title: 'Plan and billing', href: '/settings/billing' },
            { title: 'Export or close shop', href: '/settings/data' },
          ],
        },
      ],
    },
  ];
}

/** `pathname` is `prefix` or a page under it. */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The entry for this page: the one owning the longest matching address. Home
 * matches only itself; account pages match nothing.
 */
export function activeItem(groups: NavGroup[], pathname: string): NavItem | null {
  let best: { item: NavItem | null; length: number } = { item: null, length: 0 };
  const consider = (item: NavItem | null, prefix: string) => {
    const hit = prefix === '/dashboard' ? pathname === prefix : under(pathname, prefix);
    if (hit && prefix.length > best.length) best = { item, length: prefix.length };
  };
  for (const group of groups) {
    for (const item of group.items) {
      for (const prefix of [item.href, ...(item.children ?? []).map((c) => c.href), ...(item.match ?? [])]) consider(item, prefix);
    }
  }
  for (const prefix of ACCOUNT_PATHS) consider(null, prefix);
  return best.item;
}

/** Within the open entry, the child owning the longest matching address. */
export function activeChild(item: NavItem, pathname: string): string | null {
  let best: string | null = null;
  for (const child of item.children ?? []) {
    if (under(pathname, child.href) && (!best || child.href.length > best.length)) best = child.href;
  }
  return best;
}

/* ─── Sidebar context ───────────────────────────────────────────────────── */

type SidebarContextValue = {
  /** desktop: icon-only rail */
  collapsed: boolean;
  toggle: () => void;
  /** below lg: off-canvas drawer */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};
const SidebarContext = React.createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});
export const useSidebar = () => React.useContext(SidebarContext);

/* ─── Provider ──────────────────────────────────────────────────────────── */

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Starts expanded on both server and client, then applies the saved
  // preference after mount — reading localStorage during the first render
  // made the server and client HTML disagree.
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      if (localStorage.getItem('sidebar-collapsed') === 'true') setCollapsed(true);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar-collapsed', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

/* ─── Sidebar ───────────────────────────────────────────────────────────── */

type SidebarProps = {
  org: OrgInfo;
  orgs: OrgSwitcherItem[];
  user: UserInfo;
  /** the member can see messages, so Messages carries its unread count */
  showMessageCount?: boolean;
};

export function Sidebar(props: SidebarProps) {
  const { collapsed: railCollapsed, toggle, mobileOpen, setMobileOpen } = useSidebar();
  const pathname = usePathname();

  // Close the drawer on navigation and on Escape.
  React.useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);
  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      <SidebarPanel {...props} collapsed={railCollapsed} onToggle={toggle} className="hidden lg:flex" />
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          // Any link tap closes it — including the page you're already on, where the pathname doesn't change.
          onClickCapture={(e) => (e.target as HTMLElement).closest('a[href]') && setMobileOpen(false)}
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40 animate-in fade-in-0"
            onClick={() => setMobileOpen(false)}
          />
          <SidebarPanel
            {...props}
            collapsed={false}
            onToggle={() => setMobileOpen(false)}
            // `flex`, like the desktop panel: without it the menu list has no
            // height to scroll in, and a long open section (Settings) ran
            // off the bottom of the screen. `safe-y` keeps it clear of a
            // phone's status bar and home indicator in the business app.
            className="safe-y relative flex w-[272px] max-w-[85vw] shadow-xl animate-in slide-in-from-left"
            mobile
          />
        </div>
      )}
    </>
  );
}

function SidebarPanel({
  org,
  orgs,
  user,
  showMessageCount = false,
  collapsed,
  onToggle,
  className,
  mobile = false,
}: SidebarProps & { collapsed: boolean; onToggle: () => void; className?: string; mobile?: boolean }) {
  const toggle = onToggle;
  const unreadMessages = useInboxStore((s) => s.summary?.unreadConversations ?? 0);
  const rawPathname = usePathname();
  // proxy.ts rewrites the public "/dashboard" to an internal "/${slug}/dashboard",
  // and the bare public "/" to the internal "/${slug}/dashboard" as well.
  // usePathname() reflects whichever one actually matched the route for this
  // render pass: the rewritten internal path during SSR, the real (public,
  // slug-free) browser URL after client hydration. Comparing the raw value
  // against slug-free hrefs below would then disagree between server and
  // client and trigger a hydration mismatch — normalise both passes to the
  // same slug-free path, and collapse the root "/" to "/dashboard" so the
  // browser's "/" (client) lines up with the rewritten "/${slug}/dashboard"
  // (SSR).
  const stripped = rawPathname.startsWith(`/${org.slug}/`)
    ? rawPathname.slice(org.slug.length + 1)
    : rawPathname === `/${org.slug}`
      ? '/'
      : rawPathname;
  const pathname = stripped === '/' ? '/dashboard' : stripped;
  const navGroups = React.useMemo(() => buildNav(org.shopOpen), [org.shopOpen]);
  const current = activeItem(navGroups, pathname);

  return (
    <aside
      className={cn(
        'h-full flex-col border-r bg-sidebar transition-[width] duration-200 ease-in-out',
        !mobile && (collapsed ? 'w-[56px]' : 'w-[220px]'),
        className,
      )}
    >
      {/* ── Org workspace header ──────────────────────────────────────── */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b',
          collapsed ? 'justify-center px-2' : 'px-2',
        )}
      >
        <OrgSwitcher
          orgs={orgs}
          currentOrgSlug={org.slug}
          collapsed={collapsed}
        />
      </div>

      {/* ── Plan / upgrade ───────────────────────────────────────────── */}
      <div
        className={cn(
          'flex shrink-0 items-center border-b py-2',
          collapsed ? 'justify-center px-2' : 'justify-between px-3',
        )}
      >
        {collapsed ? (
          <UpgradeLink
            title={`${org.plan} — Plans`}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:text-primary"
          >
            <ArrowUpCircle className="size-4" />
          </UpgradeLink>
        ) : (
          <>
            <Badge
              variant={
                org.planState === 'active'
                  ? 'success'
                  : org.planState === 'trial'
                    ? 'info'
                    : org.planState === 'none'
                      ? 'muted'
                      : 'warning'
              }
            >
              {org.plan}
            </Badge>
            <UpgradeLink
              className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <ArrowUpCircle className="size-3" />
              {org.planState === 'active' ? 'Plans' : 'Choose a plan'}
            </UpgradeLink>
          </>
        )}
      </div>

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
        {navGroups.map((group, gi) => {
          const showDivider = collapsed && gi > 0;
          return (
            <div key={gi} className={cn('px-2', gi > 0 && 'mt-4')}>
              {group.label && !collapsed && (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {group.label}
                </p>
              )}
              {showDivider && <div className="my-2 h-px bg-sidebar-border" />}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const href = item.href;
                  const active = current === item;
                  const count = item.count === 'messages' && showMessageCount ? unreadMessages : 0;
                  const countLabel = count > 99 ? '99+' : String(count);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active && !item.children ? 'page' : undefined}
                        title={collapsed ? (count ? `${item.title} (${countLabel} unread)` : item.title) : undefined}
                        className={cn(
                          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                          active
                            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                          collapsed && 'justify-center px-0',
                        )}
                      >
                        <span className="relative flex shrink-0">
                          <item.icon
                            className={cn(
                              'size-4 shrink-0',
                              active
                                ? 'text-sidebar-primary'
                                : 'text-sidebar-foreground/50',
                            )}
                          />
                          {collapsed && count > 0 && (
                            <span aria-hidden className="absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
                          )}
                        </span>
                        {!collapsed && (
                          <span className="truncate">{item.title}</span>
                        )}
                        {!collapsed && count > 0 && (
                          <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 tabular-nums text-primary-foreground">
                            {countLabel}
                            <span className="sr-only"> unread</span>
                          </span>
                        )}
                      </Link>
                      {!collapsed && active && item.children && (
                        <ul className="mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                          {item.children.map((child) => {
                            const childHref = child.href;
                            // The longest match wins, so "Business details" at /settings
                            // doesn't also light up for /settings/members.
                            const childActive = activeChild(item, pathname) === childHref;
                            return (
                              <li key={childHref}>
                                <Link
                                  href={childHref}
                                  aria-current={childActive ? 'page' : undefined}
                                  className={cn(
                                    'flex h-7 items-center rounded-md px-2 text-[12.5px] transition-colors',
                                    childActive
                                      ? 'font-medium text-sidebar-accent-foreground'
                                      : 'text-sidebar-foreground/60 hover:text-sidebar-accent-foreground',
                                  )}
                                >
                                  <span className="truncate">{child.title}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ── User footer ──────────────────────────────────────────────── */}
      <div className="shrink-0 border-t">
        {/* User row */}
        <div
          className={cn(
            'flex items-center gap-2.5 px-3 py-3',
            collapsed && 'justify-center px-0',
          )}
        >
          {/* Avatar */}
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {user.initials}
          </div>

          {!collapsed && (
            <Link
              href="/settings/account"
              title="Your account"
              className="min-w-0 flex-1 rounded-sm hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="truncate text-[12px] font-medium text-sidebar-foreground leading-snug">
                {user.name ?? user.email}
              </p>
              {user.name && user.email && (
                <p className="truncate text-[10px] text-muted-foreground">
                  {user.email}
                </p>
              )}
            </Link>
          )}

          {!collapsed && (
            <button
              onClick={() => void signOutHere()}
              aria-label="Sign out"
              className="shrink-0 text-muted-foreground/60 transition-colors hover:text-destructive"
            >
              <LogOut className="size-3.5" />
            </button>
          )}
        </div>

        {/* Collapse toggle */}
        <div className="border-t px-2 pb-2 pt-1">
          <button
            onClick={toggle}
            aria-label={mobile ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <>
                <ChevronLeft className="size-4" />
                <span>{mobile ? 'Close menu' : 'Collapse'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

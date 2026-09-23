'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LogOut,
  Megaphone,
  Share2,
  ArrowUpCircle,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import type { OrgInfo, UserInfo } from './dashboard-layout';
import { OrgSwitcher, type OrgSwitcherItem } from '@/components/org-switcher';
import { Badge } from '@/components/ui/badge';
import { getMarketingUrl } from '@/lib/tenant/urls';

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

/* ─── Nav data ─────────────────────────────────────────────────────────── */

type NavItem = {
  title: string;
  href: string;
  icon: React.ElementType;
  children?: Omit<NavItem, 'icon' | 'children'>[];
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { title: 'Projects', href: '/projects', icon: FolderKanban },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        title: 'Procurement',
        href: '/procurement',
        icon: ShoppingCart,
        children: [
          { title: 'Purchase Orders', href: '/procurement/purchase-orders' },
          { title: 'Suppliers', href: '/procurement/suppliers' },
          { title: 'Reorder Suggestions', href: '/procurement/reorder' },
        ],
      },
      {
        title: 'Inventory',
        href: '/inventory',
        icon: Package,
        children: [
          { title: 'Products', href: '/inventory/products' },
          { title: 'Categories', href: '/inventory/categories' },
          { title: 'Collections', href: '/inventory/collections' },
          { title: 'Brands', href: '/inventory/brands' },
          { title: 'Stores', href: '/inventory/warehouses' },
          { title: 'Stock movements', href: '/inventory/movements' },
          { title: 'Transfers', href: '/inventory/transfers' },
          { title: 'Shelf locations', href: '/inventory/putaway' },
          { title: 'Stock counts', href: '/inventory/cycle-counts' },
          { title: 'Reports', href: '/inventory/reports' },
          { title: 'Sales-based reports', href: '/inventory/reports/advanced' },
        ],
      },
      {
        title: 'Sales',
        href: '/sales',
        icon: TrendingUp,
        children: [
          { title: 'Orders', href: '/sales/orders' },
          { title: 'Customers', href: '/sales/customers' },
          { title: 'Quotes', href: '/sales/quotes' },
          { title: 'Invoices', href: '/sales/invoices' },
          { title: 'Fulfillment', href: '/sales/fulfillment' },
          { title: 'Returns', href: '/sales/returns' },
          { title: 'Discount codes', href: '/sales/discounts' },
          { title: 'Reviews', href: '/sales/reviews' },
          { title: 'Questions', href: '/sales/questions' },
        ],
      },
    ],
  },
  {
    label: 'Business',
    items: [
      /* Every entry here must lead to a real page (AGENTS §7). "Suppliers"
       * and "Staff" used to sit here pointing at routes that never existed —
       * they live at /procurement/suppliers and /settings/members. A
       * business-wide Reports hub is Phase 7 in docs/ROADMAP.md; it goes back
       * in when the page exists, not before. */
      { title: 'Marketing', href: '/marketing/campaigns', icon: Megaphone },
      { title: 'Social', href: '/social', icon: Share2 },
    ],
  },
  {
    label: 'System',
    items: [
      {
        title: 'Settings',
        href: '/settings',
        icon: Settings,
        children: [
          { title: 'General', href: '/settings' },
          { title: 'Members', href: '/settings/members' },
          { title: 'Activity', href: '/settings/activity' },
          { title: 'Roles & Permissions', href: '/settings/roles' },
          { title: 'Storefront', href: '/settings/storefront' },
          { title: 'Payments', href: '/settings/payments' },
          { title: 'Delivery and returns', href: '/settings/delivery' },
          { title: 'Store pages', href: '/settings/pages' },
          { title: 'Billing', href: '/settings/billing' },
        ],
      },
    ],
  },
];

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

type SidebarProps = { org: OrgInfo; orgs: OrgSwitcherItem[]; user: UserInfo };

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
            className="relative w-[272px] max-w-[85vw] shadow-xl animate-in slide-in-from-left"
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
  collapsed,
  onToggle,
  className,
  mobile = false,
}: SidebarProps & { collapsed: boolean; onToggle: () => void; className?: string; mobile?: boolean }) {
  const toggle = onToggle;
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
          <Link
            href="/upgrade"
            title={`${PLAN_LABELS[org.plan] ?? org.plan} plan — Upgrade`}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:text-primary"
          >
            <ArrowUpCircle className="size-4" />
          </Link>
        ) : (
          <>
            <Badge variant={org.plan === 'FREE' ? 'muted' : 'success'}>
              {PLAN_LABELS[org.plan] ?? org.plan}
            </Badge>
            {org.plan !== 'ENTERPRISE' && (
              <Link
                href="/upgrade"
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <ArrowUpCircle className="size-3" />
                Upgrade
              </Link>
            )}
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
                  const active =
                    pathname === href ||
                    (href !== '/dashboard' && pathname.startsWith(`${href}/`));
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        title={collapsed ? item.title : undefined}
                        className={cn(
                          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                          active
                            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                          collapsed && 'justify-center px-0',
                        )}
                      >
                        <item.icon
                          className={cn(
                            'size-4 shrink-0',
                            active
                              ? 'text-sidebar-primary'
                              : 'text-sidebar-foreground/50',
                          )}
                        />
                        {!collapsed && (
                          <span className="truncate">{item.title}</span>
                        )}
                      </Link>
                      {!collapsed && active && item.children && (
                        <ul className="mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                          {item.children.map((child) => {
                            const childHref = child.href;
                            // childHref !== href guards against a child reusing the parent's
                            // own path (e.g. Settings' "General" at "/settings"): without it,
                            // startsWith(`${childHref}/`) would match every sibling subpage
                            // too, since they all start with "/settings/".
                            const childActive =
                              pathname === childHref ||
                              (childHref !== href && pathname.startsWith(`${childHref}/`));
                            return (
                              <li key={childHref}>
                                <Link
                                  href={childHref}
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
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-sidebar-foreground leading-snug">
                {user.name ?? user.email}
              </p>
              {user.name && user.email && (
                <p className="truncate text-[10px] text-muted-foreground">
                  {user.email}
                </p>
              )}
            </div>
          )}

          {!collapsed && (
            <button
              onClick={() => signOut({ callbackUrl: getMarketingUrl('/login') })}
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

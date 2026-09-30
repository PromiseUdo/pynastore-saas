'use client';

/*
 * The platform console's frame (ROADMAP 11.0): a sidebar grouped by job, and
 * on small screens a top bar whose menu opens the same navigation in a
 * drawer. It borrows the admin's look — tokens, sidebar colours, type scale —
 * but not the merchant sidebar itself, which is built around a workspace, its
 * plan and the workspace switcher; the console has none of those.
 *
 * Every entry leads to a real page (AGENTS §7). A console phase that adds a
 * page adds its entry here, in the group it belongs to.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, LogOut, Menu, ShieldCheck, BadgeCheck, Building2, CreditCard, Globe, Tags, SlidersHorizontal, Timer, Bug } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { SheetContent, SheetRoot, SheetTitle } from '@/components/ui/sheet';
import { getMarketingUrl } from '@/lib/tenant/urls';

type NavItem = { title: string; href: string; icon: React.ElementType };
type NavGroup = { label?: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { items: [{ title: 'Overview', href: '/platform', icon: LayoutDashboard }] },
  {
    label: 'Merchants',
    items: [
      { title: 'Merchants', href: '/platform/merchants', icon: Building2 },
      { title: 'Verification', href: '/platform/verification', icon: BadgeCheck },
    ],
  },
  {
    label: 'Operations',
    items: [
      { title: 'Payments', href: '/platform/payments', icon: CreditCard },
      { title: 'Domains', href: '/platform/domains', icon: Globe },
      { title: 'Scheduled jobs', href: '/platform/jobs', icon: Timer },
      { title: 'Errors', href: '/platform/errors', icon: Bug },
    ],
  },
  {
    label: 'Billing',
    items: [
      { title: 'Plans and pricing', href: '/platform/plans', icon: Tags },
      { title: 'Billing settings', href: '/platform/settings', icon: SlidersHorizontal },
    ],
  },
];

export interface ConsoleStaff {
  name: string;
  email: string;
}

/** A number shown beside an entry — work waiting there (e.g. submissions to review). */
export type ConsoleCounts = Partial<Record<string, number>>;

export function ConsoleShell({
  staff,
  counts,
  platformName,
  children,
}: {
  staff: ConsoleStaff;
  counts: ConsoleCounts;
  platformName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the drawer after navigating.
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ConsoleSidebar
        staff={staff}
        counts={counts}
        platformName={platformName}
        className="hidden w-[232px] shrink-0 border-r lg:flex"
      />

      <SheetRoot open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[272px] max-w-[85vw] p-0 sm:max-w-[272px]" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Console navigation</SheetTitle>
          <ConsoleSidebar staff={staff} counts={counts} platformName={platformName} className="flex h-full" />
        </SheetContent>
      </SheetRoot>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Menu className="size-4" />
          </button>
          <ConsoleMark platformName={platformName} />
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function ConsoleMark({ platformName }: { platformName: string }) {
  return (
    <Link
      href="/platform"
      className="flex min-w-0 items-center gap-2 rounded-md text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ShieldCheck className="size-4" aria-hidden />
      </span>
      <span className="truncate">
        {platformName} <span className="font-normal text-muted-foreground">console</span>
      </span>
    </Link>
  );
}

function ConsoleSidebar({
  staff,
  counts,
  platformName,
  className,
}: {
  staff: ConsoleStaff;
  counts: ConsoleCounts;
  platformName: string;
  className?: string;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/platform' ? pathname === '/platform' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className={cn('flex-col bg-sidebar', className)}>
      <div className="flex h-14 shrink-0 items-center border-b px-3">
        <ConsoleMark platformName={platformName} />
      </div>

      <nav aria-label="Console" className="flex-1 overflow-y-auto py-3">
        {NAV.map((group, gi) => (
          <div key={gi} className={cn('px-2', gi > 0 && 'mt-4')}>
            {group.label && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                const count = counts[item.href] ?? 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                      )}
                    >
                      <item.icon
                        className={cn('size-4 shrink-0', active ? 'text-sidebar-primary' : 'text-sidebar-foreground/50')}
                        aria-hidden
                      />
                      <span className="flex-1 truncate">{item.title}</span>
                      {count > 0 && (
                        <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums">
                          {count > 99 ? '99+' : count}
                          <span className="sr-only"> waiting</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-2.5 border-t px-3 py-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
          {initials(staff.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium leading-snug text-sidebar-foreground">{staff.name}</p>
          <p className="truncate text-[10px] text-muted-foreground">Platform staff</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: getMarketingUrl('/login') })}
          aria-label="Sign out"
          title="Sign out"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

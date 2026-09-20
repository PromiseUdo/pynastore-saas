'use client';

import * as React from 'react';
import { Bell, Search, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from './sidebar';
import type { UserInfo } from './dashboard-layout';

type Breadcrumb = { label: string; href?: string };

type HeaderProps = {
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
  user?: UserInfo;
  className?: string;
};

export function Header({ breadcrumbs, actions, user, className }: HeaderProps) {
  const { mobileOpen, setMobileOpen } = useSidebar();

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur-sm',
        className,
      )}
    >
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        aria-expanded={mobileOpen}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-4" />
      </button>

      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <li key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && (
                  <span className="select-none text-muted-foreground/50">/</span>
                )}
                {crumb.href && i < breadcrumbs.length - 1 ? (
                  <a
                    href={crumb.href}
                    className="truncate text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span
                    className={cn(
                      'truncate',
                      i === breadcrumbs.length - 1
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {!breadcrumbs && <div className="flex-1" />}

      {/* Right controls */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* Global search */}
        <button
          aria-label="Search"
          className="flex h-8 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-w-45 sm:justify-start"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="hidden text-xs sm:block">Search…</span>
          <kbd className="ml-auto hidden h-5 items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-[10px] text-muted-foreground sm:flex">
            <span>⌘</span>K
          </kbd>
        </button>

        {/* Notifications */}
        <button
          aria-label="Notifications"
          className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="size-4" />
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
        </button>

        {/* User avatar */}
        <div
          aria-label="User menu"
          className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
          title={user?.name ?? user?.email ?? ''}
        >
          {user?.initials ?? '?'}
        </div>

        {actions && <div className="ml-1 flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

'use client';

import * as React from 'react';
import { Menu } from 'lucide-react';
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

      {/* Right controls.
        *
        * A global search box and a notification bell used to sit here doing
        * nothing — the bell even showed a permanent unread dot. AGENTS §7:
        * build a control or leave it out. Search and notifications are
        * Phase 7 in docs/ROADMAP.md, and this is where they go. */}
      <div className="ml-auto flex items-center gap-1.5">
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

'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, LogOut, Menu, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from './sidebar';
import { NotificationBell } from '@/components/notifications/notification-bell';
import type { UserInfo } from './dashboard-layout';
import { signOutHere } from '@/components/account/sign-out';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

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

      {/* Right controls. The bell is this member's notifications in this shop
        * (ROADMAP 18.2). A global search box once sat here doing nothing —
        * AGENTS §7: build a control or leave it out. */}
      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell base="/notifications" />

        {/* The account menu: what belongs to this person rather than the shop. */}
        <DropdownMenuRoot>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              title={user?.name ?? user?.email ?? ''}
              className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {user?.initials ?? '?'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {(user?.name || user?.email) && (
              <>
                <DropdownMenuLabel className="font-normal">
                  {user?.name && <span className="block truncate text-sm font-medium">{user.name}</span>}
                  {user?.email && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <Link href="/settings/account">
                <UserRound />
                Your account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/notifications">
                <Bell />
                Notification settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOutHere()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>

        {actions && <div className="ml-1 flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

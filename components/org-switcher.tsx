'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { switchOrganization } from '@/features/org/actions';
import { getMarketingUrl } from '@/lib/tenant/urls';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type OrgSwitcherItem = {
  id: string;
  name: string;
  slug: string;
  plan: string;
};

type OrgSwitcherProps = {
  orgs: OrgSwitcherItem[];
  currentOrgSlug: string;
  collapsed?: boolean;
};

export function OrgSwitcher({ orgs, currentOrgSlug, collapsed }: OrgSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const currentOrg = orgs.find((o) => o.slug === currentOrgSlug) ?? orgs[0];

  function handleSwitch(org: OrgSwitcherItem) {
    if (org.slug === currentOrgSlug) return;
    startTransition(async () => {
      await switchOrganization(org.id);
    });
  }

  if (collapsed) {
    return (
      <DropdownMenuRoot>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Switch workspace"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground"
          >
            {currentOrg?.name.charAt(0).toUpperCase() ?? '?'}
          </button>
        </DropdownMenuTrigger>
        <OrgSwitcherMenuContent
          orgs={orgs}
          currentOrgSlug={currentOrgSlug}
          onSwitch={handleSwitch}
          isPending={isPending}
          side="right"
        />
      </DropdownMenuRoot>
    );
  }

  return (
    <DropdownMenuRoot>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-0.5',
            'text-left transition-colors hover:bg-sidebar-accent/60',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isPending && 'opacity-60',
          )}
          disabled={isPending}
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            {currentOrg?.name.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-snug text-sidebar-foreground">
              {currentOrg?.name ?? 'Select workspace'}
            </p>
            <p className="truncate text-[10px] capitalize text-muted-foreground">
              {currentOrg?.plan.toLowerCase()} plan
            </p>
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" />
        </button>
      </DropdownMenuTrigger>
      <OrgSwitcherMenuContent
        orgs={orgs}
        currentOrgSlug={currentOrgSlug}
        onSwitch={handleSwitch}
        isPending={isPending}
        side="bottom"
        align="start"
      />
    </DropdownMenuRoot>
  );
}

type MenuContentProps = {
  orgs: OrgSwitcherItem[];
  currentOrgSlug: string;
  onSwitch: (org: OrgSwitcherItem) => void;
  isPending: boolean;
  side?: 'bottom' | 'right' | 'top' | 'left';
  align?: 'start' | 'center' | 'end';
};

function OrgSwitcherMenuContent({
  orgs,
  currentOrgSlug,
  onSwitch,
  isPending,
  side = 'bottom',
  align = 'start',
}: MenuContentProps) {
  return (
    <DropdownMenuContent
      className="w-56"
      side={side}
      align={align}
      sideOffset={6}
    >
      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
      {orgs.map((org) => {
        const isActive = org.slug === currentOrgSlug;
        return (
          <DropdownMenuItem
            key={org.id}
            onSelect={() => onSwitch(org)}
            disabled={isPending && !isActive}
            className="cursor-pointer"
          >
            <div className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary">
              {org.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{org.name}</p>
              <p className="truncate text-xs capitalize text-muted-foreground">
                {org.plan.toLowerCase()}
              </p>
            </div>
            {isActive && <Check className="size-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => (window.location.href = getMarketingUrl('/onboarding'))}
        className="cursor-pointer text-muted-foreground"
      >
        <Plus className="size-4" />
        Create organization
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

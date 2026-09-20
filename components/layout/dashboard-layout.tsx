import * as React from 'react';
import { Sidebar, SidebarProvider } from './sidebar';
import { Header } from './header';
import { Toaster } from '@/components/ui/toaster';
import type { OrgSwitcherItem } from '@/components/org-switcher';

export type OrgInfo = {
  name: string;
  slug: string;
  plan: string;
};

export type UserInfo = {
  name: string | null;
  email: string | null;
  image: string | null;
  initials: string;
};

type Breadcrumb = { label: string; href?: string };

type DashboardLayoutProps = {
  children: React.ReactNode;
  org: OrgInfo;
  orgs: OrgSwitcherItem[];
  user: UserInfo;
  breadcrumbs?: Breadcrumb[];
  headerActions?: React.ReactNode;
};

export function DashboardLayout({
  children,
  org,
  orgs,
  user,
  breadcrumbs,
  headerActions,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar org={org} orgs={orgs} user={user} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header breadcrumbs={breadcrumbs} actions={headerActions} user={user} />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <Toaster />
    </SidebarProvider>
  );
}

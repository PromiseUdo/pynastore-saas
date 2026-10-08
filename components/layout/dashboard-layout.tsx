import * as React from 'react';
import { Sidebar, SidebarProvider } from './sidebar';
import { Header } from './header';
import { Toaster } from '@/components/ui/toaster';
import { InboxWatcher } from '@/components/messages/inbox-watcher';
import type { OrgSwitcherItem } from '@/components/org-switcher';

export type OrgInfo = {
  name: string;
  slug: string;
  /** the plan as shown: "Pro", "Pro · Trial", "Plan ended" (planLabel) */
  plan: string;
  planState: import('@/lib/billing/access').AccessState;
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
  /** the trial / plan-ended notice, above every page (ROADMAP 12.1) */
  notice?: React.ReactNode;
  /** holds `messages.view`: the sidebar shows the unread count (ROADMAP 17.2) */
  canViewMessages?: boolean;
};

export function DashboardLayout({
  children,
  org,
  orgs,
  user,
  breadcrumbs,
  headerActions,
  notice,
  canViewMessages = false,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar org={org} orgs={orgs} user={user} showMessageCount={canViewMessages} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header breadcrumbs={breadcrumbs} actions={headerActions} user={user} />
          {notice}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <Toaster />
      {canViewMessages && <InboxWatcher />}
    </SidebarProvider>
  );
}

import * as React from 'react';
import { Sidebar, SidebarProvider } from './sidebar';
import { Header } from './header';
import { Toaster } from '@/components/ui/toaster';
import { InboxWatcher } from '@/components/messages/inbox-watcher';
import { NoBuyingProvider } from '@/components/business-app/no-buying';
import { PhoneAlertsSync } from '@/components/business-app/phone-alerts-sync';
import type { OrgSwitcherItem } from '@/components/org-switcher';

export type OrgInfo = {
  name: string;
  slug: string;
  /** the plan as shown: "Pro", "Pro · Trial", "Plan ended" (planLabel) */
  plan: string;
  planState: import('@/lib/billing/access').AccessState;
  /** the online shop is open to customers; until then the menu leads with the setup guide */
  shopOpen: boolean;
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
  /** inside the business app: no prices, no buy buttons, no upgrade links (ROADMAP 19.3) */
  noBuying?: boolean;
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
  noBuying = false,
}: DashboardLayoutProps) {
  return (
    <NoBuyingProvider value={noBuying}>
      <SidebarProvider>
        {/* `relative` on the shell and on <main>: hidden helpers that use
          * `position: absolute` (screen-reader text, the native inputs behind
          * Radix switches, selects and checkboxes) are otherwise laid out
          * against the page itself, outside every overflow box, and one far
          * down a long page stretched the window into an empty second scroll. */}
        {/* On paper only the page itself prints (a receipt, an invoice, a
          * packing slip): no menu, top bar or plan notice, and the screen's
          * scroll boxes open up so a long page isn't cut at the first sheet. */}
        <div data-admin-shell className="relative flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
          <div className="contents print:hidden">
            <Sidebar org={org} orgs={orgs} user={user} showMessageCount={canViewMessages} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
            <div className="contents print:hidden">
              <Header breadcrumbs={breadcrumbs} actions={headerActions} user={user} />
              {notice}
            </div>
            <main className="relative flex-1 overflow-y-auto print:overflow-visible">{children}</main>
          </div>
        </div>
        <Toaster />
        {canViewMessages && <InboxWatcher />}
        <PhoneAlertsSync />
      </SidebarProvider>
    </NoBuyingProvider>
  );
}

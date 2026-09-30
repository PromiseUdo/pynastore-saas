/*
 * The public site (ROADMAP 12.3): the landing page and pricing, on the
 * platform host. The admin's tokens and type, with its own header and
 * footer. Signed-in visitors to / are sent to their shop by proxy.ts before
 * this renders.
 */
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

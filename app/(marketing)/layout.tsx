/*
 * The public site (ROADMAP 12.3, redesigned in 23): the landing page and
 * pricing, on the platform host, in the public site's own palette
 * (components/marketing/site-shell.tsx). Signed-in visitors to / are sent to
 * their shop by proxy.ts before this renders.
 */
import { SiteShell } from '@/components/marketing/site-shell';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}

/*
 * app/(legal)/layout.tsx
 *
 * Chrome for the public legal pages (/privacy, /terms). These are platform
 * pages, not tenant pages: proxy.ts serves them on the marketing/platform
 * host only (they are listed in PUBLIC_PATHS there), so they load with no
 * session and no organization — which is what the Meta App Review reviewer
 * opening the platform's /privacy in a private window needs. Everything
 * they say is in the HTML response; the header's menu is the only script.
 *
 * The same header, footer and palette as the rest of the public site
 * (ROADMAP 23), so a visitor moving from pricing to the terms stays in one
 * place.
 */
import { SiteShell } from '@/components/marketing/site-shell';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}

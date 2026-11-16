/*
 * The frame of every public page (ROADMAP 23): the landing page, pricing,
 * terms and privacy. `.site` switches on the public site's palette
 * (app/globals.css) and the display face loads here, so the admin and the
 * storefront never download it.
 */
import { Familjen_Grotesk } from 'next/font/google';
import { cn } from '@/lib/utils';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { SupportChatMount } from './support-chat-mount';

const display = Familjen_Grotesk({
  subsets: ['latin'],
  variable: '--font-mk-display-face',
  display: 'swap',
});

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn('site flex min-h-screen flex-col bg-background text-foreground antialiased', display.variable)}>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <SupportChatMount />
    </div>
  );
}

'use client';

/*
 * components/social/social-nav.tsx
 *
 * The three areas of Social Commerce, as one row of links.
 *
 * Not `PageTabs`: that component keeps its selection in a query parameter on
 * one page, and these are three separate routes with their own loading and
 * error states. Same look, real navigation.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/social', label: 'Connected accounts' },
  { href: '/social/compose', label: 'Create post' },
  { href: '/social/posts', label: 'Post history' },
] as const;

export function SocialNav() {
  const pathname = usePathname();

  return (
    <nav className="flex w-full gap-1 overflow-x-auto border-b bg-background px-6" aria-label="Social Commerce">
      {LINKS.map((link) => {
        // '/social' is only current when it's exactly that, or every tab lights up.
        const current = link.href === '/social' ? pathname.endsWith('/social') : pathname.includes(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-2 text-sm transition-colors',
              current
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

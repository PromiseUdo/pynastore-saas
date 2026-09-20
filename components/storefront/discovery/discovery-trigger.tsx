'use client';

/*
 * Wraps a discovery tile so it resolves IN PLACE instead of navigating.
 *
 * It still renders a real <Link> with a real href, for three reasons: the
 * listing routes (/c/*, /products) don't exist yet and a plain button would
 * leave nothing to fall back to; middle-click / ⌘-click still open a new tab
 * once they do; and crawlers see a genuine link either way.
 *
 * Left click is intercepted and handed to the hero via the discovery store.
 */
import Link from 'next/link';
import type { Route } from 'next';
import { useDiscoveryStore, type DiscoveryRequest } from '@/lib/storefront/stores/discovery-store';

export function DiscoveryTrigger({
  href,
  request,
  className,
  children,
}: {
  href: Route | string;
  request: DiscoveryRequest;
  className?: string;
  children: React.ReactNode;
}) {
  const submit = useDiscoveryStore((s) => s.submit);

  return (
    <Link
      href={href as Route}
      className={className}
      onClick={(e) => {
        // Leave the browser's own affordances alone.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        submit(request);
      }}
    >
      {children}
    </Link>
  );
}

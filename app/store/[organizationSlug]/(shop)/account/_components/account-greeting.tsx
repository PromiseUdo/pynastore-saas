'use client';

/*
 * The account area's heading — a welcome on the overview, a quiet label
 * everywhere else.
 *
 * "Hi, Ada" belongs on the page you land on. Repeated above "Add an address"
 * or an order you clicked into, it is chrome: on a phone it pushed the thing
 * you actually came for down past the fold, and the page's own <h1> ended up
 * competing with it for the same job.
 *
 * A client component only because the decision is "which page am I on", and
 * the answer has to survive the storefront's tenant rewrite — hence
 * usePublicPathname rather than raw usePathname.
 */
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';

export function AccountGreeting({ firstName }: { firstName: string }) {
  const pathname = usePublicPathname();
  const isOverview = pathname === '/account';

  if (!isOverview) {
    return (
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Your account
      </p>
    );
  }

  return (
    <header>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Your account
      </p>
      <h1 className="mt-0.5 font-display text-xl font-semibold tracking-tight sm:mt-1 sm:text-3xl">
        Hi, {firstName}
      </h1>
    </header>
  );
}

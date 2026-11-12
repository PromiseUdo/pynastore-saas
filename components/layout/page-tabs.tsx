'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/** `locked`: the plan doesn't include it — still shown, with a lock (AGENTS §7). */
export type PageTab = { key: string; label: string; locked?: boolean };

/**
 * Tabs whose selection lives in the URL (AGENTS.md §3), so a report can be
 * refreshed, shared or bookmarked on the view someone is actually looking at.
 */
export function PageTabs({
  tabs,
  current,
  param = 'view',
  className,
}: {
  tabs: PageTab[];
  current: string;
  /** query parameter that carries the selection */
  param?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(key: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (key === tabs[0].key) next.delete(param);
    else next.set(param, key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <nav className={cn('-mb-2.5 flex w-full gap-1 overflow-x-auto', className)} aria-label="Views">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-current={current === tab.key ? 'page' : undefined}
          onClick={() => select(tab.key)}
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-sm transition-colors',
            current === tab.key
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
          {tab.locked && (
            <>
              <Lock className="size-3" aria-hidden />
              <span className="sr-only">(not on your plan)</span>
            </>
          )}
        </button>
      ))}
    </nav>
  );
}

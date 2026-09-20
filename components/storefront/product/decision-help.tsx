/*
 * "Not sure yet?" — the shortcuts to the parts of the page that answer the
 * questions people actually have before buying.
 *
 * Every anchor here points at a section that EXISTS on this page, and one is
 * only rendered if its section was rendered. Phase 9 added the assistant as
 * the FIRST item in the row (`action`), which is exactly where this section
 * always expected it to land: the intents it serves — "something cheaper",
 * "the better version", "is this waterproof" — are the ones the anchors
 * approximate. Anything the listing can answer by scrolling still does, so
 * the assistant is an extra route to an answer rather than a toll gate in
 * front of the page.
 *
 * Server component; the launcher passed in as `action` is the only client
 * island.
 */
import type * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, HelpCircle, ImageUp, Sparkles, TrendingUp } from 'lucide-react';

export interface DecisionShortcut {
  id: string;
  /** an in-page anchor (`#similar`) or a storefront route */
  href: string;
  label: string;
  icon: 'cheaper' | 'premium' | 'similar' | 'ask' | 'visual';
}

const ICONS = {
  cheaper: ArrowDownRight,
  premium: TrendingUp,
  similar: Sparkles,
  ask: HelpCircle,
  visual: ImageUp,
} as const;

export function DecisionHelp({
  shortcuts,
  action,
}: {
  shortcuts: DecisionShortcut[];
  /** the assistant launcher — rendered first, before the page anchors */
  action?: React.ReactNode;
}) {
  if (shortcuts.length + (action ? 1 : 0) < 2) return null;

  return (
    <section aria-labelledby="decide-heading" className="rounded-2xl bg-secondary/60 p-5">
      <h2 id="decide-heading" className="text-sm font-semibold">
        Not sure about this one?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Jump to what usually settles it.
      </p>

      <ul className="sf-no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
        {action && <li className="shrink-0">{action}</li>}
        {shortcuts.map((shortcut) => {
          const Icon = ICONS[shortcut.icon];
          // An anchor stays a plain <a> (it scrolls, it does not navigate);
          // a route goes through <Link> so it doesn't reload the page.
          const Tag = shortcut.href.startsWith('#') ? 'a' : Link;
          return (
            <li key={shortcut.id} className="shrink-0">
              <Tag
                href={shortcut.href}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
              >
                <Icon aria-hidden className="size-4 text-teal" />
                {shortcut.label}
              </Tag>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

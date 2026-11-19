'use client';

/*
 * The shopping helpers, always within reach: one quiet round button in the
 * bottom-left corner of every shop page (not checkout) that opens into
 *
 *   • Ask about products — instant, automatic answers from the catalogue
 *     (the assistant sheet), seeded with the page the shopper is on;
 *   • Search by image    — the /search/image page;
 *   • Help me choose     — three questions, in a modal (guided-dialog.tsx).
 *
 * Bottom LEFT because the right-hand corner already holds "Message us" (a
 * person at the store) and the back-to-top arrow; keeping the automatic
 * helpers on the other side keeps the two kinds of help apart.
 *
 * Closed, it is a small card-coloured circle with the shop's accent on the
 * icon — present, not loud — and every few seconds a line in the shop's
 * colour runs once around its edge, so it isn't missed. Open, the three choices rise out of it, each with
 * a line saying what it does. It closes on a tap outside, Escape (focus back
 * on the button), choosing something, or moving to another page.
 *
 * Ask and Search by image need the shop's plan to include AI shopping
 * (ROADMAP 22.1); Help me choose needs only departments with products in
 * them. With nothing to offer, there's no button.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ImageUp, ListChecks, MessagesSquare, Sparkles, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAiShopping, useStorefront } from '@/lib/storefront/context';
import { useAssistantStore, type AssistantSeed } from '@/lib/storefront/stores/assistant-store';
import { useGuidedStore } from '@/lib/storefront/stores/guided-store';
import { VISUAL_SEARCH_PATH } from '@/lib/storefront/visual-search/query';
import { ASK_ABOUT_PRODUCTS } from '@/components/storefront/assistant/assistant-launcher';
import { GuidedDialog } from '@/components/storefront/discovery/guided-dialog';
import type { PriceBandOption, RootCategoryOption } from '@/components/storefront/discovery/types';

/** What the assistant is told about where it was opened, from the address alone. */
export function seedForPath(pathname: string, search = ''): AssistantSeed {
  // The shared app serves each shop under /s/{slug}.
  const path = pathname.replace(/^\/s\/[^/]+(?=\/|$)/, '') || '/';
  const product = path.match(/^\/products\/([^/]+)\/?$/);
  if (product) return { surface: 'product', productSlug: decodeURIComponent(product[1]) };
  const category = path.match(/^\/c\/(.+?)\/?$/);
  if (category) return { surface: 'category', categoryPath: category[1].split('/').map(decodeURIComponent) };
  if (path === '/search') {
    const q = new URLSearchParams(search).get('q')?.trim();
    return { surface: 'search', searchQuery: q || undefined };
  }
  if (path === '/cart') return { surface: 'cart' };
  return { surface: 'home' };
}

interface Helper {
  key: string;
  icon: LucideIcon;
  title: string;
  note: string;
  href?: string;
  onSelect?: () => void;
}

export function ShopHelperDock({
  categories,
  priceBands,
}: {
  categories: RootCategoryOption[];
  priceBands: PriceBandOption[];
}) {
  const { org } = useStorefront();
  const aiShopping = useAiShopping();
  const openAssistant = useAssistantStore((s) => s.openPanel);
  const openGuided = useGuidedStore((s) => s.setOpen);
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const toggle = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();

  // Another page: start closed.
  React.useEffect(() => setOpen(false), [pathname]);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const helpers: Helper[] = [];
  if (aiShopping) {
    helpers.push({
      key: 'ask',
      icon: MessagesSquare,
      title: ASK_ABOUT_PRODUCTS,
      note: 'Instant answers about what we sell',
      onSelect: () => openAssistant(seedForPath(pathname, window.location.search), org.slug),
    });
    helpers.push({ key: 'image', icon: ImageUp, title: 'Search by image', note: 'Find it from a photo', href: VISUAL_SEARCH_PATH });
  }
  if (categories.length > 0) {
    helpers.push({ key: 'choose', icon: ListChecks, title: 'Help me choose', note: 'Three quick questions', onSelect: () => openGuided(true) });
  }
  if (helpers.length === 0) return null;

  // The list reads top to bottom; it opens upwards, so the first one is furthest from the button.
  const count = helpers.length;
  const itemClass =
    'flex w-full items-center gap-3 rounded-2xl border bg-card py-2 pl-2 pr-4 text-left shadow-lg shadow-foreground/10 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <>
      <div ref={root} className="sf-helper-dock pointer-events-none fixed left-4 z-30 flex flex-col items-start gap-3 lg:left-6">
        <ul
          id={listId}
          aria-label="Shopping help"
          inert={!open}
          // The dock lets taps through to the page; only an open list and the button take them.
          className={cn('flex w-[min(17rem,calc(100vw-2rem))] flex-col gap-2', open && 'pointer-events-auto')}
        >
          {helpers.map((helper, index) => {
            const Icon = helper.icon;
            const body = (
              <>
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{helper.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{helper.note}</span>
                </span>
              </>
            );
            return (
              <li
                key={helper.key}
                className={cn(
                  'origin-bottom-left transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                  open ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0',
                )}
                // Nearest the button first on the way out, so they rise in order.
                style={{ transitionDelay: open ? `${(count - 1 - index) * 40}ms` : '0ms' }}
              >
                {helper.href ? (
                  <Link href={helper.href} onClick={() => setOpen(false)} className={itemClass}>
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      helper.onSelect?.();
                    }}
                    className={itemClass}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? 'Close shopping help' : 'Shopping help: ask about products, search by image, help me choose'}
          title={open ? undefined : 'Shopping help'}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'pointer-events-auto relative flex size-12 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            // Closed, a line now and then runs once around it so it isn't missed (storefront.css).
            open ? 'border-brand bg-brand text-primary-foreground' : 'sf-helper-ring bg-card text-brand hover:border-brand',
          )}
        >
          <Sparkles aria-hidden className={cn('size-5 transition-all duration-200', open ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100')} />
          <X aria-hidden className={cn('absolute size-5 transition-all duration-200', open ? 'rotate-0 scale-100' : '-rotate-90 scale-0 opacity-0')} />
        </button>
      </div>

      {categories.length > 0 && <GuidedDialog categories={categories} priceBands={priceBands} />}
    </>
  );
}

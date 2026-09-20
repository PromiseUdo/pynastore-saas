'use client';

/*
 * The header's inline search field — the primary way into the catalogue on
 * this storefront, so it gets the centre of the header rather than an icon.
 *
 * Suggestions come from /api/storefront/suggest (a top-level route: proxy.ts
 * excludes /api from the tenant rewrite, so storefront APIs can't live under
 * app/store/[organizationSlug]). The small-screen header keeps the icon +
 * <SearchOverlay> sheet instead; this component is the lg+ experience.
 */
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Loader2, Search, TrendingUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/storefront/format';
import { useStorefront } from '@/lib/storefront/context';
import { categoryHref } from '@/lib/storefront/nav-types';

interface Suggestions {
  products: {
    id: string;
    slug: string;
    name: string;
    brand: string;
    image: string;
    priceFrom: number;
    currency: string;
  }[];
  categories: { id: string; name: string; path: string[] }[];
  brands: { id: string; name: string; slug: string }[];
}

const TRENDING = ['Headphones', 'Wrap dress', 'Standing desk', 'Vitamin C serum', 'Kettlebell'];

export function HeaderSearch({ className }: { className?: string }) {
  // The suggestions/product endpoints sit outside the tenant rewrite, so the
  // request has to name its store (see the route's header comment).
  const { org } = useStorefront();
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [data, setData] = React.useState<Suggestions | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Debounced suggest. The abort controller matters here: without it a slow
  // early response can land after a later one and overwrite fresher results.
  React.useEffect(() => {
    if (q.trim().length < 2) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/storefront/suggest?q=${encodeURIComponent(q)}&store=${encodeURIComponent(org.slug)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: Suggestions) => setData(d))
        .catch(() => {
          /* aborted or offline — keep the previous suggestions on screen */
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q]);

  // Dismiss on outside click / Escape.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const hasResults =
    !!data && (data.products.length > 0 || data.categories.length > 0 || data.brands.length > 0);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      {/* One soft pill rather than an input welded to a dark submit block —
        * the header sits on cream and a heavy dark rectangle up there fought
        * with the hero underneath it. */}
      <form
        onSubmit={submit}
        role="search"
        className="flex items-center gap-2 rounded-full border border-border bg-card pl-4 pr-1.5 transition-colors focus-within:border-brand"
      >
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search for products, brands and more…"
          aria-label="Search the store"
          autoComplete="off"
          // `min-w-0` is load-bearing: an <input>'s default intrinsic width
          // would otherwise stop the flex item shrinking and push the submit
          // button out of the form.
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              setData(null);
            }}
            aria-label="Clear search"
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
        <button
          type="submit"
          aria-label="Search"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        </button>
      </form>

      {open && (
        <div className="sf-fade-in absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border bg-elevated shadow-2xl">
          {q.trim().length < 2 ? (
            <div className="p-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="size-3.5" /> Trending searches
              </p>
              <div className="flex flex-wrap gap-2">
                {TRENDING.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setQ(t)}
                    className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-brand hover:text-brand"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : !hasResults ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {loading ? 'Searching…' : `No matches for “${q.trim()}” — try a broader term.`}
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto sf-thin-scrollbar">
              {data!.products.length > 0 && (
                <ul className="p-2">
                  {data!.products.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/products/${p.slug}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
                      >
                        <Image
                          src={p.image}
                          alt=""
                          width={44}
                          height={44}
                          className="size-11 shrink-0 rounded-md bg-tile object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span className="block text-xs text-muted-foreground">{p.brand}</span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-price">
                          {formatMoney(p.priceFrom, p.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {(data!.categories.length > 0 || data!.brands.length > 0) && (
                <div className="flex flex-wrap gap-2 border-t p-3">
                  {data!.categories.map((c) => (
                    <Link
                      key={c.id}
                      href={categoryHref(c.path)}
                      onClick={() => setOpen(false)}
                      className="rounded-full bg-secondary px-3 py-1 text-xs transition-colors hover:text-brand"
                    >
                      in {c.name}
                    </Link>
                  ))}
                  {data!.brands.map((b) => (
                    <Link
                      key={b.id}
                      href={`/search?q=${encodeURIComponent(b.name)}`}
                      onClick={() => setOpen(false)}
                      className="rounded-full bg-secondary px-3 py-1 text-xs transition-colors hover:text-brand"
                    >
                      {b.name}
                    </Link>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                className="w-full border-t p-3 text-sm font-semibold text-brand transition-colors hover:bg-accent"
              >
                See all results for “{q.trim()}”
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ProductImage } from '@/components/storefront/product/product-image';
import { useRouter } from 'next/navigation';
import { Search, X, TrendingUp } from 'lucide-react';
import { SheetRoot, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useStorefront } from '@/lib/storefront/context';
import { formatMoney } from '@/lib/storefront/format';
import { categoryHref } from '@/lib/storefront/nav-types';
import { ImageSearchLink } from '@/components/storefront/visual-search/image-search-link';

interface Suggestions {
  products: { id: string; slug: string; name: string; brand: string; /** null when the merchant hasn't added one */ image: string | null; priceFrom: number; currency: string }[];
  categories: { id: string; name: string; path: string[] }[];
  brands: { id: string; name: string; slug: string }[];
}

const TRENDING = ['Headphones', 'Wrap dress', 'Standing desk', 'Vitamin C serum', 'Sneakers'];

export function SearchOverlay() {
  // The suggestions/product endpoints sit outside the tenant rewrite, so the
  // request has to name its store (see the route's header comment).
  const { org } = useStorefront();
  const overlay = useUIStore((s) => s.overlay);
  const close = useUIStore((s) => s.close);
  const open = overlay === 'search';
  const router = useRouter();

  const [q, setQ] = React.useState('');
  const [data, setData] = React.useState<Suggestions | null>(null);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setQ('');
  }, [open]);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/storefront/suggest?q=${encodeURIComponent(q)}&store=${encodeURIComponent(org.slug)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: Suggestions) => setData(d))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    close();
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <SheetRoot open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="inset-x-0 top-0 h-auto max-h-[90vh] w-full max-w-none border-l-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top sm:max-w-none"
      >
        <SheetTitle className="sr-only">Search the store</SheetTitle>
        <SheetDescription className="sr-only">
          Find products, brands and categories. Suggestions appear as you type.
        </SheetDescription>
        <div className="sf-container py-4">
          <form onSubmit={submit} className="flex items-center gap-3 border-b pb-4">
            <Search className="size-5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search for products, brands and categories"
              className="h-10 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              autoComplete="off"
            />
            <button type="button" onClick={close} aria-label="Close search" className="rounded-md p-1.5 hover:bg-accent">
              <X className="size-5" />
            </button>
          </form>

          <div className="max-h-[60vh] overflow-y-auto py-4">
            {/* The phone's most natural way to search for something you can
              * see but can't name. First, because that is when it is useful. */}
            <ImageSearchLink
              variant="row"
              label="Search by image"
              onNavigate={close}
              className="mb-4 -mx-3 border-b pb-3.5"
            />

            {q.trim().length < 2 && (
              <div>
                <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <TrendingUp className="size-3.5" /> Trending searches
                </p>
                <div className="flex flex-wrap gap-2">
                  {TRENDING.map((t) => (
                    <button
                      key={t}
                      onClick={() => setQ(t)}
                      className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading && <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>}

            {data && !loading && (
              <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
                <div className="space-y-4">
                  {data.categories.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</p>
                      <ul className="space-y-1">
                        {data.categories.map((c) => (
                          <li key={c.id}>
                            <Link href={categoryHref(c.path)} onClick={close} className="text-sm hover:text-brand">
                              {c.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {data.brands.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brands</p>
                      <ul className="space-y-1">
                        {data.brands.map((b) => (
                          <li key={b.id}>
                            <Link href={`/search?q=${encodeURIComponent(b.name)}`} onClick={close} className="text-sm hover:text-brand">
                              {b.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</p>
                  {data.products.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No product matches — try a broader term.</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {data.products.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/products/${p.slug}`}
                            onClick={close}
                            className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
                          >
                            <ProductImage
                              src={p.image}
                              name={p.name}
                              alt=""
                              width={48}
                              height={48}
                              className="size-12 shrink-0 rounded-md object-cover"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{p.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {p.brand} · {formatMoney(p.priceFrom, p.currency)}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button onClick={submit} className="mt-3 text-sm font-medium text-brand hover:underline">
                    See all results for “{q}” →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

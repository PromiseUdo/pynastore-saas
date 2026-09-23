'use client';

/*
 * The prominent search field on /search.
 *
 * Distinct from <HeaderSearch> on purpose: this one is seeded from the URL
 * (so the box always reflects the results below it), keeps the current
 * filters when the query is refined, and is keyboard-navigable through its
 * suggestions. It shares the /api/storefront/suggest endpoint, so the header
 * and the page can never return different matches for the same text.
 *
 * Submitting REPLACES the query while preserving sort and filters — a shopper
 * refining "coat" to "wool coat" has not asked to lose their price filter.
 */
import * as React from 'react';
import Image from 'next/image';
import { ProductImage } from '@/components/storefront/product/product-image';
import { useRouter } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/storefront/format';
import { categoryHref } from '@/lib/storefront/nav-types';
import { useStorefront } from '@/lib/storefront/context';
import { buildHref, patchCriteria, type DiscoveryCriteria } from '@/lib/storefront/discovery-url';
import type { OptionIndex } from '@/lib/storefront/types';

interface Suggestions {
  products: { id: string; slug: string; name: string; brand: string; /** null when the merchant hasn't added one */ image: string | null; priceFrom: number; currency: string }[];
  categories: { id: string; name: string; path: string[] }[];
  brands: { id: string; name: string; slug: string }[];
  terms: string[];
}

const EMPTY: Suggestions = { products: [], categories: [], brands: [], terms: [] };

export function SearchField({
  criteria,
  optionIndex,
  pathname,
  placeholder = 'Search for products, brands and categories',
}: {
  criteria: DiscoveryCriteria;
  optionIndex: OptionIndex;
  pathname: string;
  placeholder?: string;
}) {
  const router = useRouter();
  // The suggestions endpoint sits outside the tenant rewrite, so the request
  // has to name its store (see app/api/storefront/suggest/route.ts).
  const { org } = useStorefront();
  const [value, setValue] = React.useState(criteria.q ?? '');
  const [data, setData] = React.useState<Suggestions>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(-1);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Re-seed when the URL changes underneath us (back button, a chip removal).
  React.useEffect(() => setValue(criteria.q ?? ''), [criteria.q]);

  /* Debounced suggest. The AbortController matters: without it a slow early
   * response can land after a later one and overwrite fresher suggestions. */
  React.useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/storefront/suggest?q=${encodeURIComponent(q)}&store=${encodeURIComponent(org.slug)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : EMPTY))
        .then((d: Suggestions) => setData({ ...EMPTY, ...d }))
        .catch(() => {
          /* aborted or offline — keep whatever is on screen */
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  /* Refining the query keeps the current filters and sort — someone
   * narrowing "coat" to "wool coat" has not asked to lose their price band. */
  const search = React.useCallback(
    (q: string) => buildHref(pathname, patchCriteria(criteria, { q: q.trim() || undefined }), optionIndex),
    [criteria, optionIndex, pathname],
  );

  /* One flat list so ↑/↓ walk every suggestion regardless of its group. */
  const items = React.useMemo(
    () => [
      ...data.terms.map((t) => ({ key: `t:${t}`, href: search(t) })),
      ...data.categories.map((c) => ({ key: `c:${c.id}`, href: categoryHref(c.path) })),
      ...data.brands.map((b) => ({ key: `b:${b.id}`, href: search(b.name) })),
      ...data.products.map((p) => ({ key: `p:${p.id}`, href: `/products/${p.slug}` })),
    ],
    [data, search],
  );

  const go = (href: string) => {
    setOpen(false);
    setCursor(-1);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c <= 0 ? items.length - 1 : c - 1));
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault();
      go(items[cursor].href);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    go(search(value));
  };

  const hasSuggestions = items.length > 0;
  const activeId = cursor >= 0 ? items[cursor]?.key : undefined;

  return (
    <div ref={wrapRef} className="relative mt-4 max-w-2xl sm:mt-5">
      <form
        onSubmit={submit}
        role="search"
        className="flex items-center gap-2 rounded-full border-2 border-border bg-card pl-4 pr-1 transition-colors focus-within:border-brand sm:pr-1.5"
      >
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setCursor(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search the store"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && hasSuggestions}
          aria-controls="search-suggestions"
          aria-activedescendant={activeId}
          // min-w-0 is load-bearing: an input's intrinsic width would stop
          // this flex item shrinking and push the button out of the form.
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setData(EMPTY);
            }}
            aria-label="Clear search"
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
        <button
          type="submit"
          className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          <span className="hidden sm:inline">Search</span>
        </button>
      </form>

      {open && hasSuggestions && (
        <div
          id="search-suggestions"
          role="listbox"
          className="sf-fade-in absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border bg-elevated shadow-2xl sf-thin-scrollbar"
        >
          {data.terms.length > 0 && <Group label="Suggestions" />}
          {data.terms.map((term) => (
            <Row key={`t:${term}`} id={`t:${term}`} active={activeId === `t:${term}`} onSelect={() => go(search(term))}>
              <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{term}</span>
            </Row>
          ))}

          {data.categories.length > 0 && <Group label="Categories" />}
          {data.categories.map((category) => (
            <Row
              key={`c:${category.id}`}
              id={`c:${category.id}`}
              active={activeId === `c:${category.id}`}
              onSelect={() => go(categoryHref(category.path))}
            >
              <span className="truncate">{category.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">Category</span>
            </Row>
          ))}

          {data.brands.length > 0 && <Group label="Brands" />}
          {data.brands.map((brand) => (
            <Row
              key={`b:${brand.id}`}
              id={`b:${brand.id}`}
              active={activeId === `b:${brand.id}`}
              onSelect={() => go(search(brand.name))}
            >
              <span className="truncate">{brand.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">Brand</span>
            </Row>
          ))}

          {data.products.length > 0 && <Group label="Products" />}
          {data.products.map((product) => (
            <Row
              key={`p:${product.id}`}
              id={`p:${product.id}`}
              active={activeId === `p:${product.id}`}
              onSelect={() => go(`/products/${product.slug}`)}
            >
              <ProductImage
                src={product.image}
                name={product.name}
                alt=""
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-md bg-tile object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{product.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{product.brand}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-price">
                {formatMoney(product.priceFrom, product.currency)}
              </span>
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}

function Group({ label }: { label: string }) {
  return (
    <p className="border-b bg-secondary/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
  );
}

function Row({
  id,
  active,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      onClick={onSelect}
      // Generous touch target — these are tapped on a phone far more often
      // than they are clicked.
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      {children}
    </button>
  );
}

'use client';

/*
 * The filter body. ONE component renders both the desktop sidebar and the
 * contents of the mobile sheet — filters that disagree between breakpoints
 * are a classic source of "it worked on my laptop" bugs.
 *
 * Every change is written to the URL, never to local state, so a filtered
 * view is refreshable, shareable and back-navigable. `useTransition` keeps
 * the control responsive while the server re-renders the grid, and surfaces
 * a pending style instead of freezing.
 *
 * Which facets appear is decided by the DATA, not by a hardcoded list: the
 * option groups come from the current result pool, so Storage shows on
 * electronics and Size on fashion, and neither shows on a page without them.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { RatingStars } from '@/components/storefront/common/rating-stars';
import { currencySymbol } from '@/lib/storefront/format';
import {
  buildHref,
  patchCriteria,
  toggleInList,
  type DiscoveryCriteria,
} from '@/lib/storefront/discovery-url';
import type { OptionIndex, ProductFacets } from '@/lib/storefront/types';
import type { PricePreset } from '@/lib/storefront/product-discovery';

export interface FilterPanelProps {
  criteria: DiscoveryCriteria;
  facets: ProductFacets;
  optionIndex: OptionIndex;
  pricePresets: PricePreset[];
  currency: string;
  /** the public path this view lives at, e.g. '/search' — passed from the
   *  server rather than read from usePathname(), which reports the internal
   *  tenant-rewritten path during SSR */
  pathname: string;
  /** called after a navigation starts — lets the mobile sheet close itself */
  onNavigate?: () => void;
}

export function FilterPanel({
  criteria,
  facets,
  optionIndex,
  pricePresets,
  currency,
  pathname,
  onNavigate,
}: FilterPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const apply = React.useCallback(
    (patch: Partial<DiscoveryCriteria>) => {
      const href = buildHref(pathname, patchCriteria(criteria, patch), optionIndex);
      startTransition(() => {
        router.push(href, { scroll: false });
        onNavigate?.();
      });
    },
    [criteria, optionIndex, pathname, router, onNavigate],
  );

  return (
    <div className={cn('divide-y', pending && 'pointer-events-none opacity-60 transition-opacity')}>
      <PriceSection
        criteria={criteria}
        presets={pricePresets}
        facets={facets}
        currency={currency}
        onApply={apply}
      />

      {facets.brands.length > 1 && (
        <Section title="Brand" count={criteria.brandSlugs.length}>
          <ScrollList>
            {facets.brands.map((bucket) => (
              <CheckRow
                key={bucket.value}
                checked={criteria.brandSlugs.includes(bucket.value)}
                onChange={() => apply({ brandSlugs: toggleInList(criteria.brandSlugs, bucket.value) })}
                label={bucket.label}
                count={bucket.count}
              />
            ))}
          </ScrollList>
        </Section>
      )}

      {facets.options.map((group) => {
        const entry = optionIndex.find((e) => e.name === group.name);
        const selected = group.buckets.filter((b) => criteria.optionValueIds.includes(b.value)).length;
        if (!entry || group.buckets.length < 2) return null;

        return (
          <Section key={group.name} title={group.name} count={selected}>
            {group.kind === 'color' ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {group.buckets.map((bucket) => {
                  const active = criteria.optionValueIds.includes(bucket.value);
                  return (
                    <button
                      key={bucket.value}
                      type="button"
                      aria-pressed={active}
                      title={`${bucket.label} (${bucket.count})`}
                      onClick={() =>
                        apply({ optionValueIds: toggleInList(criteria.optionValueIds, bucket.value) })
                      }
                      className={cn(
                        'flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors',
                        active ? 'border-brand bg-brand/5 font-semibold' : 'hover:border-foreground/30',
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-5 rounded-full border border-black/10"
                        style={{ background: bucket.swatch ?? '#ccc' }}
                      />
                      {bucket.label}
                    </button>
                  );
                })}
              </div>
            ) : group.kind === 'size' ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {group.buckets.map((bucket) => {
                  const active = criteria.optionValueIds.includes(bucket.value);
                  return (
                    <button
                      key={bucket.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        apply({ optionValueIds: toggleInList(criteria.optionValueIds, bucket.value) })
                      }
                      className={cn(
                        'min-w-11 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                        active
                          ? 'border-brand bg-brand text-primary-foreground'
                          : 'hover:border-foreground/30',
                      )}
                    >
                      {bucket.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <ScrollList>
                {group.buckets.map((bucket) => (
                  <CheckRow
                    key={bucket.value}
                    checked={criteria.optionValueIds.includes(bucket.value)}
                    onChange={() =>
                      apply({ optionValueIds: toggleInList(criteria.optionValueIds, bucket.value) })
                    }
                    label={bucket.label}
                    count={bucket.count}
                  />
                ))}
              </ScrollList>
            )}
          </Section>
        );
      })}

      {/* Only a store with reviews offers a rating filter — see
        * lib/storefront/catalog.ts:computeFacets. */}
      {facets.ratings.some((r) => r.count > 0) && (
      <Section title="Rating" count={criteria.minRating ? 1 : 0}>
        <div className="space-y-1">
          {facets.ratings
            .filter((r) => r.count > 0)
            .map((bucket) => {
              const value = Number(bucket.value);
              const active = criteria.minRating === value;
              return (
                <button
                  key={bucket.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => apply({ minRating: active ? undefined : value })}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent',
                    active && 'bg-accent font-semibold',
                  )}
                >
                  <RatingStars value={value} size={13} />
                  <span className="text-xs">& up</span>
                  <span className="ml-auto text-xs text-muted-foreground">{bucket.count}</span>
                </button>
              );
            })}
        </div>
      </Section>
      )}

      <Section title="Availability" count={criteria.inStockOnly ? 1 : 0}>
        <CheckRow
          checked={criteria.inStockOnly}
          onChange={() => apply({ inStockOnly: !criteria.inStockOnly })}
          label="In stock only"
        />
      </Section>
    </div>
  );
}

/* ─────────────────────────────── price ─────────────────────────────── */

function PriceSection({
  criteria,
  presets,
  facets,
  currency,
  onApply,
}: {
  criteria: DiscoveryCriteria;
  presets: PricePreset[];
  facets: ProductFacets;
  currency: string;
  onApply: (patch: Partial<DiscoveryCriteria>) => void;
}) {
  /* The two number inputs are the one place local state is correct: a URL
   * write per keystroke would fire a navigation for "1", "12", "120"… They
   * are committed on submit/blur, and re-synced whenever the URL changes. */
  const toMajor = (v?: number) => (v == null ? '' : String(v / 100));
  const [min, setMin] = React.useState(toMajor(criteria.minPrice));
  const [max, setMax] = React.useState(toMajor(criteria.maxPrice));

  React.useEffect(() => {
    setMin(toMajor(criteria.minPrice));
    setMax(toMajor(criteria.maxPrice));
  }, [criteria.minPrice, criteria.maxPrice]);

  const commit = (e: React.FormEvent) => {
    e.preventDefault();
    const parse = (v: string) => {
      const n = Number(v.replace(/[^0-9.]/g, ''));
      return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
    };
    const lo = parse(min);
    const hi = parse(max);
    // Swap rather than reject: someone typing 100000–5000 means a range.
    onApply(
      lo != null && hi != null && lo > hi
        ? { minPrice: hi, maxPrice: lo }
        : { minPrice: lo, maxPrice: hi },
    );
  };

  const symbol = currencySymbol(currency);

  const activePreset = presets.find(
    (p) => p.minPrice === criteria.minPrice && p.maxPrice === criteria.maxPrice,
  );

  return (
    <Section title="Price" count={criteria.minPrice != null || criteria.maxPrice != null ? 1 : 0}>
      {presets.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {presets.map((preset) => {
            const active = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onApply(
                    active
                      ? { minPrice: undefined, maxPrice: undefined }
                      : { minPrice: preset.minPrice, maxPrice: preset.maxPrice },
                  )
                }
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  active
                    ? 'border-brand bg-brand text-primary-foreground'
                    : 'hover:border-foreground/30',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={commit} className="flex items-center gap-2">
        <label className="sr-only" htmlFor="price-min">Minimum price ({symbol})</label>
        <input
          id="price-min"
          inputMode="numeric"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          onBlur={commit}
          placeholder={`${symbol}${Math.floor(facets.priceMin / 100)}`}
          className="h-9 w-full min-w-0 rounded-lg border bg-background px-2.5 text-sm outline-none focus:border-brand"
        />
        <span aria-hidden className="text-muted-foreground">–</span>
        <label className="sr-only" htmlFor="price-max">Maximum price ({symbol})</label>
        <input
          id="price-max"
          inputMode="numeric"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          onBlur={commit}
          placeholder={`${symbol}${Math.ceil(facets.priceMax / 100)}`}
          className="h-9 w-full min-w-0 rounded-lg border bg-background px-2.5 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors hover:border-brand hover:text-brand"
        >
          Go
        </button>
      </form>
    </Section>
  );
}

/* ─────────────────────────────── pieces ────────────────────────────── */

/** Collapsible group. Open by default — a shopper should see what they can
 *  narrow by without a round of clicking to find out. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <section className="py-4 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 pb-2 text-left"
      >
        <span className="text-sm font-semibold">
          {title}
          {count ? <span className="ml-1.5 text-xs font-normal text-brand">({count})</span> : null}
        </span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && children}
    </section>
  );
}

/** Long facet lists scroll rather than pushing everything below off-screen. */
function ScrollList({ children }: { children: React.ReactNode }) {
  return <div className="sf-thin-scrollbar max-h-56 space-y-0.5 overflow-y-auto pr-1">{children}</div>;
}

function CheckRow({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  count?: number;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent">
      <CheckboxRoot checked={checked} onCheckedChange={onChange} />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {count != null && <span className="text-xs text-muted-foreground">{count}</span>}
    </label>
  );
}

'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Loader2, Package, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cloudinaryImage } from '@/lib/cloudinary/url';
import { formatMoney } from '@/lib/format';
import { searchCollectionProducts, type CollectionProductRow } from '@/features/inventory/actions';

function Thumb({ url }: { url: string | null }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Cloudinary does the resizing
        <img src={cloudinaryImage(url, { width: 72, height: 72 })} alt="" className="size-full object-cover" />
      ) : (
        <Package className="size-4" />
      )}
    </div>
  );
}

/** Ordered, hand-picked members of a collection. */
export function ProductPicker({
  value,
  onChange,
  disabled,
}: {
  value: CollectionProductRow[];
  onChange: (products: CollectionProductRow[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<CollectionProductRow[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const chosenIds = React.useMemo(() => value.map((p) => p.id), [value]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const result = await searchCollectionProducts(query, chosenIds);
      if (cancelled) return;
      setResults(result.success ? result.data : []);
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, chosenIds, open]);

  function move(index: number, to: number) {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {value.length > 0 ? (
        <ol className="divide-y rounded-md border">
          {value.map((product, index) => (
            <li key={product.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <Thumb url={product.imageUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-mono">{product.sku}</span>
                  <span>{formatMoney(product.price)}</span>
                  {!product.isPublished && <Badge variant="draft">Not published</Badge>}
                </p>
              </div>
              {!disabled && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${product.name} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${product.name} down`}
                    disabled={index === value.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${product.name}`} onClick={() => onChange(value.filter((p) => p.id !== product.id))}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No products yet. Search below to add the first one — the order you set here is the order customers see.
        </p>
      )}

      {!disabled && (
        <div className="space-y-2">
          <Input
            aria-label="Search products to add"
            placeholder="Search products by name or SKU…"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            startAdornment={<Search className="size-3.5" />}
            endAdornment={
              open ? (
                <button
                  type="button"
                  aria-label="Close product search"
                  onClick={() => {
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              ) : undefined
            }
          />

          {open && (
            <div className="max-h-72 overflow-y-auto rounded-md border">
              {searching ? (
                <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {query.trim() ? `No products match “${query.trim()}”.` : 'Every product is already in this collection.'}
                </p>
              ) : (
                <ul className="divide-y">
                  {results.map((product) => (
                    <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                      <Thumb url={product.imageUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{product.name}</p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-mono">{product.sku}</span>
                          <span>{formatMoney(product.price)}</span>
                          {!product.isPublished && <Badge variant="draft">Not published</Badge>}
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="xs" onClick={() => onChange([...value, product])}>
                        <Plus className="size-3" />
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

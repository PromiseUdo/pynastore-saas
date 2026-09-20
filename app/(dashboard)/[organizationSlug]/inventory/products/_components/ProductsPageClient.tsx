'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Boxes,
  Eye,
  EyeOff,
  Hammer,
  Layers,
  MoreHorizontal,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { cloudinaryImage } from '@/lib/cloudinary/url';
import { enumLabel, formatMoneyRange, formatNumber } from '@/lib/format';
import {
  setProductPublished,
  type BrandRow,
  type CategoryWithCounts,
  type ItemListRow,
  type ProductListParams,
  type ProductListResult,
  type ProductListRow,
  type WarehouseRow,
} from '@/features/inventory/actions';
import { CategorySelect } from '../../_components/CategorySelect';
import { AddStockDialog } from '../../_components/AddStockDialog';
import { CreateKitDialog } from './CreateKitDialog';
import { AssembleKitDialog } from './AssembleKitDialog';

type ProductsPageClientProps = {
  result: ProductListResult;
  params: ProductListParams;
  categories: CategoryWithCounts[];
  brands: BrandRow[];
  warehouses: WarehouseRow[];
  kitCandidates: ItemListRow[];
  can: { create: boolean; edit: boolean; assembleKits: boolean; recordStock: boolean };
  kitsEnabled: boolean;
};

const VIEWS = [
  { key: 'all', label: 'All', params: {} },
  { key: 'published', label: 'Published', params: { online: 'published' } },
  { key: 'draft', label: 'Not published', params: { online: 'draft' } },
  { key: 'low', label: 'Low stock', params: { stock: 'low' } },
  { key: 'out', label: 'Out of stock', params: { stock: 'out' } },
] as const;

function currentView(params: ProductListParams): string {
  if (params.online === 'published' && !params.stock) return 'published';
  if (params.online === 'draft' && !params.stock) return 'draft';
  if (params.stock === 'low' && !params.online) return 'low';
  if (params.stock === 'out' && !params.online) return 'out';
  return params.online || params.stock ? '' : 'all';
}

export function ProductsPageClient({
  result,
  params,
  categories,
  brands,
  warehouses,
  kitCandidates,
  can,
  kitsEnabled,
}: ProductsPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startTransition] = React.useTransition();

  const [query, setQuery] = React.useState(params.q ?? '');
  const [kitOpen, setKitOpen] = React.useState(false);
  const [assembling, setAssembling] = React.useState<ProductListRow | null>(null);
  const [addingStockTo, setAddingStockTo] = React.useState<ProductListRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const onlineStoreCount = warehouses.filter((w) => w.sellsOnline && w.status === 'ACTIVE').length;

  /** Writes filters to the URL; any filter change returns to page 1. */
  const update = React.useCallback(
    (patch: Record<string, string | undefined>, { keepPage = false } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!keepPage) next.delete('page');
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounced search
  React.useEffect(() => {
    if (query === (params.q ?? '')) return;
    const t = setTimeout(() => update({ q: query.trim() || undefined }), 300);
    return () => clearTimeout(t);
  }, [query, params.q, update]);

  const hasFilters = Boolean(params.q || params.categoryId || params.brandId || params.status || params.online || params.stock);
  const view = currentView(params);

  async function togglePublished(row: ProductListRow) {
    setBusyId(row.id);
    const res = await setProductPublished(row.id, !row.isPublished);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.error, {
        action: { label: 'Open product', onClick: () => router.push(`/inventory/products/${row.id}`) },
      });
      return;
    }
    toast.success(row.isPublished ? `“${row.name}” is no longer on your online store` : `“${row.name}” is now on your online store`);
    router.refresh();
  }

  const newProductButton = can.create ? (
    <Link href="/inventory/products/new" className={buttonVariants({ size: 'sm' })}>
      <Plus className="size-3.5" />
      New product
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you stock and sell — in your stores and on your online store."
        actions={
          result.catalogSize > 0 ? (
            <>
              {can.create && kitsEnabled && (
                <Button variant="outline" size="sm" onClick={() => setKitOpen(true)}>
                  <Layers className="size-3.5" />
                  New kit
                </Button>
              )}
              {newProductButton}
            </>
          ) : undefined
        }
      />

      {result.catalogSize > 0 && (
        <>
          <PageToolbar className="gap-y-2">
            <nav aria-label="Product views" className="-mb-2.5 flex w-full gap-1 overflow-x-auto">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  aria-current={view === v.key ? 'page' : undefined}
                  onClick={() => update({ online: undefined, stock: undefined, ...v.params })}
                  className={cn(
                    'whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-sm transition-colors',
                    view === v.key
                      ? 'border-primary font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v.label}
                </button>
              ))}
            </nav>
          </PageToolbar>
          <PageToolbar>
            <div className="w-full sm:w-64">
              <Input
                aria-label="Search products"
                placeholder="Search name, SKU or barcode…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                startAdornment={<Search className="size-3.5" />}
                endAdornment={
                  query ? (
                    <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                      <X className="size-3.5" />
                    </button>
                  ) : undefined
                }
              />
            </div>
            <div className="w-[calc(50%-4px)] sm:w-52">
              <CategorySelect
                categories={categories}
                value={params.categoryId ?? null}
                onChange={(v) => update({ category: v ?? undefined })}
                noneLabel="All categories"
              />
            </div>
            {brands.length > 0 && (
              <div className="w-[calc(50%-4px)] sm:w-40">
                <SelectRoot value={params.brandId ?? 'all'} onValueChange={(v) => update({ brand: v === 'all' ? undefined : v })}>
                  <SelectTrigger aria-label="Brand">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All brands</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </div>
            )}
            <div className="w-[calc(50%-4px)] sm:w-40">
              <SelectRoot value={params.status ?? 'current'} onValueChange={(v) => update({ status: v === 'current' ? undefined : v })}>
                <SelectTrigger aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Not archived</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="DISCONTINUED">Discontinued</SelectItem>
                  <SelectItem value="ARCHIVED">Archived</SelectItem>
                  <SelectItem value="all">Any status</SelectItem>
                </SelectContent>
              </SelectRoot>
            </div>
            <div className="w-[calc(50%-4px)] sm:w-44">
              <SelectRoot value={params.sort ?? 'name'} onValueChange={(v) => update({ sort: v === 'name' ? undefined : v })}>
                <SelectTrigger aria-label="Sort by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="stock-asc">Lowest stock first</SelectItem>
                  <SelectItem value="stock-desc">Highest stock first</SelectItem>
                </SelectContent>
              </SelectRoot>
            </div>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('');
                  update({ q: undefined, category: undefined, brand: undefined, status: undefined, online: undefined, stock: undefined });
                }}
              >
                Clear filters
              </Button>
            )}
          </PageToolbar>
        </>
      )}

      <PageBody className={cn('transition-opacity', isNavigating && 'opacity-60')}>
        {result.catalogSize > 0 && onlineStoreCount === 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/40">
            <span className="text-amber-800 dark:text-amber-300">
              No store is selling online yet, so published products will show as sold out on your website.
            </span>
            <Link href="/inventory/warehouses" className="shrink-0 font-medium text-amber-800 hover:underline dark:text-amber-300">
              Choose stores
            </Link>
          </div>
        )}

        {result.catalogSize === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Package className="size-5" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-foreground">Add your first product</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Products are what you keep in stock and sell. Add photos, prices and sizes or colours once — they’re used in your
              stores, on invoices and on your online store.
            </p>
            {newProductButton ? <div className="mt-4">{newProductButton}</div> : (
              <p className="mt-4 text-xs text-muted-foreground">Ask an admin to add products.</p>
            )}
            {categories.length === 0 && can.create && (
              <p className="mt-3 text-xs text-muted-foreground">
                Tip: <Link href="/inventory/categories" className="text-primary hover:underline">set up categories</Link> first so
                products are easy to file.
              </p>
            )}
          </div>
        ) : result.rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
            <Boxes className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">No products match these filters</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setQuery('');
                update({ q: undefined, category: undefined, brand: undefined, status: undefined, online: undefined, stock: undefined });
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Product</TableColumnHeader>
                  <TableColumnHeader className="hidden lg:table-cell">Category</TableColumnHeader>
                  <TableColumnHeader align="right">Price</TableColumnHeader>
                  <TableColumnHeader align="right">Available</TableColumnHeader>
                  <TableColumnHeader className="hidden md:table-cell">Online store</TableColumnHeader>
                  <TableColumnHeader>
                    <span className="sr-only">Actions</span>
                  </TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    clickable
                    className={cn(busyId === row.id && 'opacity-60')}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a,button,[role=menuitem]')) return;
                      router.push(`/inventory/products/${row.id}`);
                    }}
                  >
                    <TableCell className="py-2">
                      <div className="flex min-w-56 items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
                          {row.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary does the resizing
                            <img src={cloudinaryImage(row.imageUrl, { width: 80, height: 80 })} alt="" className="size-full object-cover" />
                          ) : (
                            <Package className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/inventory/products/${row.id}`}
                            className="block truncate font-medium text-foreground hover:underline"
                          >
                            {row.name}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="font-mono">{row.sku}</span>
                            {row.itemType === 'KIT' && <Badge variant="info">Kit</Badge>}
                            {row.variantCount > 0 && <Badge variant="muted">{row.variantCount} variants</Badge>}
                            {row.status !== 'ACTIVE' && <Badge variant={row.status === 'ARCHIVED' ? 'cancelled' : 'warning'}>{enumLabel(row.status)}</Badge>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell muted className="hidden max-w-56 truncate lg:table-cell" title={row.categoryPath.join(' › ')}>
                      {row.categoryPath.length ? row.categoryPath.join(' › ') : '—'}
                    </TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular-nums">
                      {formatMoneyRange(row.priceMin, row.priceMax)}
                    </TableCell>
                    <TableCell align="right" className="whitespace-nowrap">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={cn('tabular-nums', row.stockState === 'out' && 'text-destructive')}>
                          {formatNumber(row.available)} <span className="text-xs text-muted-foreground">{row.unit}</span>
                        </span>
                        {row.stockState === 'low' && <Badge variant="warning">Low stock</Badge>}
                        {row.stockState === 'out' && <Badge variant="destructive">Out of stock</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {row.isPublished ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="success" dot className="w-fit">
                            Published
                          </Badge>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {row.onlineAvailable > 0 ? `${formatNumber(row.onlineAvailable)} for sale online` : 'Sold out online'}
                          </span>
                        </div>
                      ) : (
                        <Badge variant="draft" className="w-fit">
                          Not published
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <DropdownMenuRoot>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => router.push(`/inventory/products/${row.id}`)}>
                            <Pencil />
                            {can.edit ? 'Edit' : 'View'}
                          </DropdownMenuItem>
                          {can.recordStock && row.itemType !== 'KIT' && (
                            <DropdownMenuItem onSelect={() => setAddingStockTo(row)}>
                              <PackagePlus />
                              Add stock
                            </DropdownMenuItem>
                          )}
                          {can.edit && row.status === 'ACTIVE' && (
                            <DropdownMenuItem onSelect={() => togglePublished(row)}>
                              {row.isPublished ? <EyeOff /> : <Eye />}
                              {row.isPublished ? 'Remove from online store' : 'Publish to online store'}
                            </DropdownMenuItem>
                          )}
                          {row.itemType === 'KIT' && can.assembleKits && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => setAssembling(row)}>
                                <Hammer />
                                Assemble kits
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenuRoot>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {result.pageCount > 1 || result.total > result.perPage ? (
              <TablePagination
                page={result.page}
                totalPages={result.pageCount}
                totalItems={result.total}
                pageSize={result.perPage}
                onPageChange={(page) => update({ page: page > 1 ? String(page) : undefined }, { keepPage: true })}
              />
            ) : (
              <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                {result.total} product{result.total === 1 ? '' : 's'}
              </p>
            )}
          </TableWrapper>
        )}
      </PageBody>

      <AddStockDialog
        open={addingStockTo !== null}
        onOpenChange={(open) => !open && setAddingStockTo(null)}
        productId={addingStockTo?.id ?? null}
        warehouses={warehouses}
      />
      {kitsEnabled && <CreateKitDialog open={kitOpen} onOpenChange={setKitOpen} candidateItems={kitCandidates} />}
      <AssembleKitDialog open={assembling !== null} onOpenChange={(v) => !v && setAssembling(null)} kit={assembling} warehouses={warehouses} />
    </>
  );
}

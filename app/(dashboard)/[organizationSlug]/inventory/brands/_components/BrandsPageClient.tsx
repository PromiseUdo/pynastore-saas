'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, MoreHorizontal, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { cloudinaryImage } from '@/lib/cloudinary/url';
import { deleteBrand, type BrandRow } from '@/features/inventory/actions';
import { BrandSheet } from './BrandSheet';

export function BrandsPageClient({ brands, canManage }: { brands: BrandRow[]; canManage: boolean }) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BrandRow | null>(null);
  const [deleting, setDeleting] = React.useState<BrandRow | null>(null);
  const [pending, setPending] = React.useState(false);

  function open(brand: BrandRow | null) {
    setEditing(brand);
    setSheetOpen(true);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteBrand(deleting.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted “${deleting.name}”`);
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Brands"
        description="The makers behind your products. Customers can browse and filter by them."
        actions={
          canManage && brands.length > 0 ? (
            <Button size="sm" onClick={() => open(null)}>
              <Plus className="size-3.5" />
              New brand
            </Button>
          ) : undefined
        }
      />

      <PageBody>
        {brands.length === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Tag className="size-5" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-foreground">No brands yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the labels or manufacturers you stock — like Nike or your own house brand. You can also add one straight from a
              product.
            </p>
            {canManage ? (
              <Button size="sm" className="mt-4" onClick={() => open(null)}>
                <Plus className="size-3.5" />
                Add your first brand
              </Button>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">Ask an admin to add brands.</p>
            )}
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Brand</TableColumnHeader>
                  <TableColumnHeader className="hidden sm:table-cell">Web address</TableColumnHeader>
                  <TableColumnHeader align="right">Products</TableColumnHeader>
                  <TableColumnHeader>
                    <span className="sr-only">Actions</span>
                  </TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {brands.map((brand) => (
                  <TableRow key={brand.id} clickable={canManage} onClick={canManage ? () => open(brand) : undefined}>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
                          {brand.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary does the resizing
                            <img src={cloudinaryImage(brand.logoUrl, { width: 80, height: 80, crop: 'fit' })} alt="" className="size-full object-contain" />
                          ) : (
                            <Tag className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{brand.name}</p>
                          {brand.description && <p className="truncate text-xs text-muted-foreground">{brand.description}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell muted className="hidden font-mono text-xs sm:table-cell">
                      /brands/{brand.slug}
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex flex-col items-end gap-0.5">
                        <Link
                          href={`/inventory/products?brand=${brand.id}`}
                          className="tabular-nums text-foreground hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {brand.productCount}
                        </Link>
                        {brand.productCount > 0 && (
                          <Badge variant={brand.publishedCount > 0 ? 'success' : 'muted'}>{brand.publishedCount} published</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell align="right">
                      {canManage && (
                        <DropdownMenuRoot>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${brand.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onSelect={() => open(brand)}>
                              <Pencil />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(brand)}>
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenuRoot>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </PageBody>

      {canManage && (
        <>
          <BrandSheet open={sheetOpen} onOpenChange={setSheetOpen} editing={editing} />
          <AlertDialogRoot open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  {deleting && deleting.productCount > 0
                    ? `Its ${deleting.productCount} product${deleting.productCount === 1 ? '' : 's'} will stay exactly as ${deleting.productCount === 1 ? 'it is' : 'they are'} — ${deleting.productCount === 1 ? 'it' : 'they'} simply won’t show a brand any more. This can’t be undone.`
                    : 'This can’t be undone.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  Delete brand
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogRoot>
        </>
      )}
    </>
  );
}

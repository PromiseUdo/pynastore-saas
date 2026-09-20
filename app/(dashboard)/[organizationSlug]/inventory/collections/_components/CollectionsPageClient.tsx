'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, EyeOff, Layers, Loader2, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
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
import { formatNumber } from '@/lib/format';
import { collectionKindLabel } from '@/features/inventory/collection-rules';
import { deleteCollection, moveCollection, updateCollectionVisibility, type CollectionListRow } from '@/features/inventory/actions';

type Props = { collections: CollectionListRow[]; canManage: boolean };

export function CollectionsPageClient({ collections, canManage }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState<CollectionListRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function run(id: string, action: () => Promise<{ success: boolean; error?: string }>, success?: string) {
    setBusyId(id);
    const result = await action();
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error ?? 'Something went wrong');
      return;
    }
    if (success) toast.success(success);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteCollection(deleting.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted “${deleting.name}”`);
    setDeleting(null);
    router.refresh();
  }

  const newButton = canManage ? (
    <Link href="/inventory/collections/new" className={buttonVariants({ size: 'sm' })}>
      <Plus className="size-3.5" />
      New collection
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="Collections"
        description="Groups that cut across categories, like “Travel essentials” or “Under ₦20,000”."
        actions={collections.length > 0 ? newButton : undefined}
      />

      <PageBody>
        {collections.length === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Layers className="size-5" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-foreground">Group products for shoppers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A category says what a product is; a collection says why it’s grouped. Pick products by hand, or set conditions — like
              “on sale, under ₦20,000” — and let the collection keep itself up to date.
            </p>
            {newButton ? <div className="mt-4">{newButton}</div> : <p className="mt-4 text-xs text-muted-foreground">Ask an admin to set up collections.</p>}
          </div>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Collection</TableColumnHeader>
                  <TableColumnHeader className="hidden sm:table-cell">Type</TableColumnHeader>
                  <TableColumnHeader align="right">Products</TableColumnHeader>
                  <TableColumnHeader>
                    <span className="sr-only">Actions</span>
                  </TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {collections.map((c, index) => (
                  <TableRow
                    key={c.id}
                    clickable
                    className={cn(busyId === c.id && 'opacity-60')}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a,button,[role=menuitem]')) return;
                      router.push(`/inventory/collections/${c.id}`);
                    }}
                  >
                    <TableCell className="py-2">
                      <div className="flex min-w-56 items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
                          {c.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary does the resizing
                            <img src={cloudinaryImage(c.imageUrl, { width: 80, height: 80 })} alt="" className="size-full object-cover" />
                          ) : (
                            <Layers className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/inventory/collections/${c.id}`} className="block truncate font-medium text-foreground hover:underline">
                            {c.name}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="font-mono">/collections/{c.slug}</span>
                            {c.isFeatured && (
                              <Badge variant="info">
                                <Star className="size-3" />
                                Featured
                              </Badge>
                            )}
                            {!c.isVisible && (
                              <Badge variant="muted">
                                <EyeOff className="size-3" />
                                Hidden
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={c.kind === 'DYNAMIC' ? 'info' : 'muted'}>{collectionKindLabel(c.kind)}</Badge>
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="tabular-nums">{formatNumber(c.productCount)}</span>
                        {c.productCount === 0 ? (
                          <Badge variant="warning">Empty</Badge>
                        ) : c.publishedCount === 0 ? (
                          <Badge variant="warning">None published</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{formatNumber(c.publishedCount)} live</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell align="right">
                      {canManage && (
                        <DropdownMenuRoot>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onSelect={() => router.push(`/inventory/collections/${c.id}`)}>
                              <Pencil />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                run(
                                  c.id,
                                  () => updateCollectionVisibility(c.id, !c.isVisible),
                                  c.isVisible ? `“${c.name}” is hidden from your online store` : `“${c.name}” is now in your online store`,
                                )
                              }
                            >
                              {c.isVisible ? <EyeOff /> : <Eye />}
                              {c.isVisible ? 'Hide from online store' : 'Show in online store'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={index === 0} onSelect={() => run(c.id, () => moveCollection(c.id, 'up'))}>
                              <ArrowUp />
                              Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={index === collections.length - 1} onSelect={() => run(c.id, () => moveCollection(c.id, 'down'))}>
                              <ArrowDown />
                              Move down
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(c)}>
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
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
              Customers see collections in this order. Use “Move up” and “Move down” to change it.
            </p>
          </TableWrapper>
        )}
      </PageBody>

      {canManage && (
        <AlertDialogRoot open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The products stay in your catalog — only this grouping is removed. Customers following an old link to it will see a
                “not found” page. This can’t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                Delete collection
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      )}
    </>
  );
}

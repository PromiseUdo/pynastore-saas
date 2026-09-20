'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { deleteCategory, type CategoryWithCounts } from '@/features/inventory/actions';

type DeleteCategoryDialogProps = {
  category: CategoryWithCounts | null;
  childCount: number;
  onOpenChange: (open: boolean) => void;
};

export function DeleteCategoryDialog({ category, childCount, onOpenChange }: DeleteCategoryDialogProps) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);

  const blocked = category ? childCount > 0 || category.itemCount > 0 : false;

  async function handleDelete() {
    if (!category) return;
    setIsPending(true);
    const result = await deleteCategory(category.id);
    setIsPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted “${category.name}”`);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <AlertDialogRoot open={category !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? `“${category?.name}” can’t be deleted yet` : `Delete “${category?.name}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocked ? (
              <>
                It still contains{' '}
                {[
                  childCount > 0 && `${childCount} subcategor${childCount === 1 ? 'y' : 'ies'}`,
                  (category?.itemCount ?? 0) > 0 && `${category?.itemCount} item${category?.itemCount === 1 ? '' : 's'}`,
                ]
                  .filter(Boolean)
                  .join(' and ')}
                . Move or delete {childCount + (category?.itemCount ?? 0) === 1 ? 'it' : 'them'} first, so nothing ends up without a home.
              </>
            ) : (
              'It will disappear from your catalog and online store. Customers following an old link to it will see a “not found” page. This can’t be undone.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? 'OK' : 'Cancel'}</AlertDialogCancel>
          {!blocked && (
            // Not AlertDialogAction: that closes the dialog before the request finishes.
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Delete category
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}

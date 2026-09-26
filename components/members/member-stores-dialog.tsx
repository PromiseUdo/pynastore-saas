'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { setMemberStores } from '@/features/members/actions';

export type StoreOption = { id: string; name: string; isOpen: boolean };

/**
 * Which stores one member may change stock in (ROADMAP Phase 8.6).
 *
 * "All stores" is a real choice, not the absence of one: it is what almost
 * every member has, it covers stores opened later, and it is how a restriction
 * is undone. Picking no store at all is therefore the same as picking all of
 * them, and the dialog says so rather than leaving someone with nothing.
 */
export function MemberStoresDialog({
  open,
  onOpenChange,
  member,
  stores,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { id: string; name: string; storeIds: string[]; isOwner: boolean } | null;
  stores: StoreOption[];
}) {
  const router = useRouter();
  const [allStores, setAllStores] = React.useState(true);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (!open || !member) return;
    setAllStores(member.storeIds.length === 0);
    setPicked(new Set(member.storeIds));
    setError(null);
  }, [open, member]);

  if (!member) return null;

  function toggle(storeId: string, checked: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(storeId);
      else next.delete(storeId);
      return next;
    });
  }

  const target = member;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const warehouseIds = allStores ? [] : [...picked];
    if (!allStores && warehouseIds.length === 0) {
      setError('Choose at least one store, or give them every store.');
      return;
    }

    setIsPending(true);
    setError(null);
    const result = await setMemberStores({ membershipId: target.id, warehouseIds });
    setIsPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(
      warehouseIds.length === 0
        ? `${target.name} can work in every store`
        : `${target.name} can work in ${warehouseIds.length} store${warehouseIds.length === 1 ? '' : 's'}`,
    );
    router.refresh();
    onOpenChange(false);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Stores for {member.name}</DialogTitle>
            <DialogDescription>
              Their role decides what they can do; this decides where. It limits changes to stock — moving it, counting it, selling it — and
              not what they can see.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {member.isOwner ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                An owner always has every store, including any you open later. Change their role first if you need to limit them.
              </p>
            ) : (
              <>
                <label className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
                  <CheckboxRoot checked={allStores} onCheckedChange={(value: boolean | 'indeterminate') => setAllStores(value === true)} aria-label="All stores" />
                  <span>
                    <span className="block text-sm font-medium text-foreground">All stores</span>
                    <span className="block text-xs text-muted-foreground">
                      Including any store you open later. This is what most people have.
                    </span>
                  </span>
                </label>

                <fieldset disabled={allStores} className="space-y-1.5 disabled:opacity-50">
                  <Label className="text-xs text-muted-foreground">Or only these</Label>
                  {stores.length === 0 ? (
                    <p className="text-sm text-muted-foreground">You have no stores yet.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {stores.map((store) => (
                        <li key={store.id}>
                          <label className="flex items-center gap-2.5 px-3 py-2">
                            <CheckboxRoot
                              checked={picked.has(store.id)}
                              disabled={allStores}
                              onCheckedChange={(value: boolean | 'indeterminate') => toggle(store.id, value === true)}
                              aria-label={store.name}
                            />
                            <span className="text-sm text-foreground">{store.name}</span>
                            {!store.isOpen && <span className="text-xs text-muted-foreground">· closed</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </fieldset>
              </>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            {!member.isOwner && (
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending && <Loader2 className="size-3.5 animate-spin" />}
                Save stores
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Globe, Pencil, Plus, Store } from 'lucide-react';
import { SwitchRoot } from '@/components/ui/switch';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StoreDialog } from './StoreDialog';
import { setWarehouseSellsOnline, type WarehouseRow } from '@/features/inventory/actions';

type WarehousesPageClientProps = {
  warehouses: WarehouseRow[];
  canManage: boolean;
  canEdit: boolean;
  maxWarehouses: number | null;
  organizationSlug: string;
};

export function WarehousesPageClient({
  warehouses,
  canManage,
  canEdit,
  maxWarehouses,
  organizationSlug,
}: WarehousesPageClientProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WarehouseRow | null>(null);

  function openDialog(store: WarehouseRow | null) {
    setEditing(store);
    setDialogOpen(true);
  }
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const onlineCount = warehouses.filter((w) => w.sellsOnline && w.status === 'ACTIVE').length;

  async function toggleOnline(w: WarehouseRow, sellsOnline: boolean) {
    setBusyId(w.id);
    const result = await setWarehouseSellsOnline(w.id, sellsOnline);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(sellsOnline ? `Your online store now sells stock from ${w.name}` : `${w.name} no longer supplies your online store`);
    router.refresh();
  }
  const atLimit = maxWarehouses !== null && warehouses.length >= maxWarehouses;

  return (
    <>
      <PageHeader
        title="Stores"
        description={
          maxWarehouses === null
            ? 'Anywhere you keep stock — shops, warehouses, even a van.'
            : `${warehouses.length} of ${maxWarehouses} store${maxWarehouses === 1 ? '' : 's'} used on your plan.`
        }
        actions={
          canManage ? (
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" onClick={() => openDialog(null)} disabled={atLimit}>
                <Plus className="size-3.5" />
                New store
              </Button>
              {atLimit && (
                <Link href="/upgrade" className="text-xs text-primary hover:underline">
                  Upgrade to add more stores
                </Link>
              )}
            </div>
          ) : undefined
        }
      />

      <PageBody>
        {warehouses.length > 0 && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground">
              {onlineCount === 0 ? (
                <>
                  <span className="font-medium text-foreground">No store sells online yet.</span> Turn on “Sells online” for the stores your website should
                  sell from — customers can buy whatever is available in those stores.
                </>
              ) : (
                <>
                  Your online store sells stock available in{' '}
                  <span className="font-medium text-foreground">
                    {warehouses.filter((w) => w.sellsOnline && w.status === 'ACTIVE').map((w) => w.name).join(', ')}
                  </span>
                  .
                </>
              )}
            </p>
          </div>
        )}
        {warehouses.length === 0 ? (
          <EmptyState
            icon={Store}
            title="Add your first store"
            description="Stock is counted per store, so create one for each place you keep goods. You can choose which ones your website sells from."
            action={
              canManage ? (
                <Button size="sm" onClick={() => openDialog(null)}>
                  <Plus className="size-3.5" />
                  New store
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {warehouses.map((w) => (
              <Card key={w.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle>{w.name}</CardTitle>
                    {w.location && <p className="mt-0.5 text-xs text-muted-foreground">{w.location}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">{w.itemCount} product{w.itemCount === 1 ? "" : "s"} stocked here</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={w.status === 'ACTIVE' ? 'success' : 'muted'}>
                      {w.status === 'ACTIVE' ? 'Open' : 'Closed'}
                    </Badge>
                    {canEdit && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${w.name}`} onClick={() => openDialog(w)}>
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <label className="flex items-center justify-between gap-3 border-t px-4 py-3">
                  <span>
                    <span className="block text-sm font-medium text-foreground">Sells online</span>
                    <span className="block text-xs text-muted-foreground">
                      {w.status !== 'ACTIVE' ? 'Reactivate the store to sell online.' : w.sellsOnline ? 'Website customers can buy this stock.' : 'Stock here isn’t offered online.'}
                    </span>
                  </span>
                  <SwitchRoot
                    checked={w.sellsOnline}
                    disabled={!canEdit || busyId === w.id || (w.status !== 'ACTIVE' && !w.sellsOnline)}
                    onCheckedChange={(v) => toggleOnline(w, v)}
                    aria-label={`${w.name} sells online`}
                  />
                </label>
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      <StoreDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </>
  );
}

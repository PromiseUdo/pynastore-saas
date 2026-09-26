'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { generateReorderDrafts, type ReorderDraftGroup } from '@/features/procurement/actions';

type ReorderPageClientProps = {
  groups: ReorderDraftGroup[];
  /** Set when the list was narrowed to one store, so the page can say so. */
  storeName: string | null;
  canGenerate: boolean;
};

export function ReorderPageClient({ groups, storeName, canGenerate }: ReorderPageClientProps) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [generated, setGenerated] = React.useState<Set<string>>(new Set());

  function keyOf(group: ReorderDraftGroup) {
    return `${group.warehouseId}:${group.supplierId}`;
  }

  async function handleGenerate(group: ReorderDraftGroup) {
    const key = keyOf(group);
    setPendingKey(key);
    setError(null);

    const result = await generateReorderDrafts([
      {
        warehouseId: group.warehouseId,
        supplierId: group.supplierId,
        items: group.items.map((i) => ({ inventoryItemId: i.inventoryItemId, quantity: i.quantity })),
      },
    ]);

    setPendingKey(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setGenerated((prev) => new Set(prev).add(key));
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Reorder suggestions"
        description={
          storeName
            ? `What ${storeName} needs, grouped by preferred supplier. A store's own reorder point is used where it has one.`
            : 'Products at or below their reorder point, grouped by store and preferred supplier.'
        }
        actions={
          storeName ? (
            <Link href="/procurement/reorder" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              All stores
            </Link>
          ) : undefined
        }
      />

      <PageBody>
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
            <Sparkles className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {storeName ? `Nothing to reorder for ${storeName} right now` : 'Nothing to reorder right now'}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              A product shows up here once it is at or below its reorder point AND has a preferred supplier — set that on the product, so we
              know who to order from.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const key = keyOf(group);
              const isGenerated = generated.has(key);
              return (
                <Card key={key}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>
                        {group.supplierName} → {group.warehouseName}
                      </CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">{group.items.length} item(s) below reorder point</p>
                    </div>
                    {canGenerate &&
                      (isGenerated ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 className="size-3.5" />
                          Draft created
                        </span>
                      ) : (
                        <Button size="sm" onClick={() => handleGenerate(group)} disabled={pendingKey === key}>
                          {pendingKey === key && <Loader2 className="size-3.5 animate-spin" />}
                          Generate PO draft
                        </Button>
                      ))}
                  </CardHeader>
                  <div className="px-4 pb-1">
                    <ul className="divide-y">
                      {group.items.map((item) => (
                        <li key={item.inventoryItemId} className="flex items-center justify-between py-2 text-sm">
                          <div>
                            <span className="font-medium text-foreground">{item.itemName}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{item.sku}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.currentStock} on hand (reorder at {item.reorderPoint}) → suggest {item.quantity}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}

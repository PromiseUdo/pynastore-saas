'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { setItemLocation } from '@/features/inventory/actions';

type LocationCellProps = {
  inventoryItemId: string;
  warehouseId: string;
  location: string | null;
  disabled: boolean;
};

export function LocationCell({ inventoryItemId, warehouseId, location, disabled }: LocationCellProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(location ?? '');
  const [isPending, setIsPending] = React.useState(false);

  if (disabled) {
    return <span className="text-xs text-muted-foreground">{location ?? '—'}</span>;
  }

  async function save() {
    const next = value.trim();
    if (next === (location ?? '')) {
      setEditing(false);
      return;
    }
    setIsPending(true);
    const result = await setItemLocation({ inventoryItemId, warehouseId, location: next || undefined });
    setIsPending(false);
    setEditing(false);
    if (!result.success) {
      setValue(location ?? '');
      toast.error(result.error);
      return;
    }
    toast.success(next ? `Location set to ${next}` : 'Location cleared');
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-xs text-foreground hover:text-primary"
      >
        {location ?? <span className="text-muted-foreground">Set location</span>}
        <Pencil className="size-3 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        className="h-7 w-40 text-xs"
        value={value}
        placeholder="e.g. Aisle 4, Shelf B"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            setValue(location ?? '');
            setEditing(false);
          }
        }}
        onBlur={save}
        disabled={isPending}
      />
      {isPending && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

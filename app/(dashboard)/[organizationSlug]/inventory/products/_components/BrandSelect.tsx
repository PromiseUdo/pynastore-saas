'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { createBrand, type BrandRow } from '@/features/inventory/actions';

const NONE = '__none__';

type BrandSelectProps = {
  id?: string;
  brands: BrandRow[];
  value: string | null;
  onChange: (id: string | null) => void;
  onBrandCreated: (brand: BrandRow) => void;
  canCreate: boolean;
  disabled?: boolean;
};

export function BrandSelect({ id, brands, value, onChange, onBrandCreated, canCreate, disabled }: BrandSelectProps) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);

  async function add() {
    if (!name.trim()) return;
    setPending(true);
    const result = await createBrand(name);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    onBrandCreated(result.data);
    onChange(result.data.id);
    setName('');
    setAdding(false);
  }

  if (adding) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          autoFocus
          placeholder="Brand name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
            if (e.key === 'Escape') setAdding(false);
          }}
        />
        <Button type="button" size="sm" onClick={add} disabled={pending || !name.trim()}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <SelectRoot value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
        <SelectTrigger id={id} className="min-w-0 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No brand</SelectItem>
          {brands.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectRoot>
      {canCreate && !disabled && (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} aria-label="Add a new brand">
          <Plus className="size-3.5" />
          New
        </Button>
      )}
    </div>
  );
}

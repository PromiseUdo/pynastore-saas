'use client';

import * as React from 'react';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { buildCategoryTree, flattenCategoryTree } from '@/features/inventory/category-tree';
import type { CategoryWithCounts } from '@/features/inventory/actions';

const NONE = '__none__';

type CategorySelectProps = {
  id?: string;
  categories: CategoryWithCounts[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** label for the empty choice, e.g. "Uncategorized" or "None — top level" */
  noneLabel: string;
  /** return a reason to disable an option (shown next to it), or null */
  disabledReason?: (category: CategoryWithCounts) => string | null;
};

/**
 * Category picker that shows the hierarchy — every option reads as its full
 * path ("Fashion › Women › Skirts"), so two "Shoes" categories under different
 * parents can't be confused.
 */
export function CategorySelect({ id, categories, value, onChange, noneLabel, disabledReason }: CategorySelectProps) {
  const options = React.useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);

  return (
    <SelectRoot value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {options.map((c) => {
          const reason = disabledReason?.(c) ?? null;
          return (
            <SelectItem key={c.id} value={c.id} disabled={reason !== null} title={reason ?? undefined}>
              {c.namePath.join(' › ')}
            </SelectItem>
          );
        })}
      </SelectContent>
    </SelectRoot>
  );
}

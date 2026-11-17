'use client';

/*
 * Category picker that shows the hierarchy — every option reads as its full
 * path ("Fashion › Women › Skirts"), so two "Shoes" categories under different
 * parents can't be confused.
 *
 * Searchable (components/ui/searchable-select.tsx): a shop with a hundred
 * categories can't be scrolled through, and typing "oud" finds
 * "Arabian & oil perfumes › Oud".
 */
import * as React from 'react';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { buildCategoryTree, flattenCategoryTree } from '@/features/inventory/category-tree';
import type { CategoryWithCounts } from '@/features/inventory/actions';

type CategorySelectProps = {
  id?: string;
  categories: CategoryWithCounts[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** label for the empty choice, e.g. "Uncategorized" or "None — top level" */
  noneLabel: string;
  /** return a reason to disable an option (shown next to it), or null */
  disabledReason?: (category: CategoryWithCounts) => string | null;
  /** for a picker with no visible <Label>, e.g. a list filter */
  ariaLabel?: string;
  disabled?: boolean;
};

export function CategorySelect({ id, categories, value, onChange, noneLabel, disabledReason, ariaLabel, disabled }: CategorySelectProps) {
  const options = React.useMemo<SearchableOption[]>(
    () => [
      { value: null, label: noneLabel },
      ...flattenCategoryTree(buildCategoryTree(categories)).map((c) => ({
        value: c.id,
        label: c.namePath.join(' › '),
        disabledReason: disabledReason?.(c) ?? null,
      })),
    ],
    [categories, noneLabel, disabledReason],
  );

  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      noun="categories"
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  );
}

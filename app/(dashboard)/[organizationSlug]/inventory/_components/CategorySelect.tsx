'use client';

/*
 * Category picker that shows the hierarchy — every option reads as its full
 * path ("Fashion › Women › Skirts"), so two "Shoes" categories under different
 * parents can't be confused.
 *
 * Searchable: a shop with a hundred categories can't be scrolled through, so
 * the list opens with a search box that matches any part of the path ("oud"
 * finds "Arabian & oil perfumes › Oud"), ignoring case and accents. The list
 * itself is capped in height and scrolls.
 *
 * Keyboard: type to filter, ↑ ↓ to move, Enter to choose, Escape to close.
 * The categories are already in the browser (the page loads them all), so
 * filtering is instant and needs no server call.
 */
import * as React from 'react';
import { Popover } from 'radix-ui';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePortalContainer } from '@/components/ui/portal-container';
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

type Option = { id: string | null; label: string; search: string; reason: string | null };

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function CategorySelect({
  id,
  categories,
  value,
  onChange,
  noneLabel,
  disabledReason,
  ariaLabel,
  disabled,
}: CategorySelectProps) {
  const container = usePortalContainer();
  const autoId = React.useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-list`;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);

  const options = React.useMemo<Option[]>(() => {
    const tree = flattenCategoryTree(buildCategoryTree(categories));
    return [
      { id: null, label: noneLabel, search: fold(noneLabel), reason: null },
      ...tree.map((c) => {
        const label = c.namePath.join(' › ');
        return { id: c.id, label, search: fold(label), reason: disabledReason?.(c) ?? null };
      }),
    ];
  }, [categories, noneLabel, disabledReason]);

  const shown = React.useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    // Every word somewhere in the path; the "none" choice only when unfiltered.
    return options.filter((o) => o.id !== null && words.every((w) => o.search.includes(w)));
  }, [options, query]);

  const selected = options.find((o) => o.id === value) ?? options[0];

  // Open on the current choice, with an empty search.
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    }
  };

  React.useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active, open, shown]);

  const choose = (option: Option) => {
    if (option.reason) return;
    onChange(option.id);
    setOpen(false);
  };

  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < shown.length; i += step) {
      if (!shown[i].reason) return i;
    }
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => move(i, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => move(i, -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(move(-1, 1));
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(move(shown.length, -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = shown[active];
      if (option) choose(option);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-left text-sm text-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <span className="line-clamp-1 min-w-0">{selected.label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>

      <Popover.Portal container={container}>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            // Focus the search box, not the first row.
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector('input')?.focus();
          }}
          className={cn(
            'z-50 w-[var(--radix-popover-trigger-width)] min-w-[16rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        >
          <div className="relative border-b">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              role="combobox"
              aria-label="Search categories"
              aria-controls={listId}
              aria-expanded
              aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${baseId}-opt-${active}` : undefined}
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search categories"
              className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {shown.length ? (
            <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel ?? 'Categories'} className="max-h-72 overflow-y-auto overscroll-contain p-1">
              {shown.map((option, index) => {
                const isSelected = option.id === value;
                return (
                  <li
                    key={option.id ?? '__none__'}
                    id={`${baseId}-opt-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.reason ? true : undefined}
                    title={option.reason ?? undefined}
                    onMouseMove={() => !option.reason && setActive(index)}
                    // Keep focus in the search box while clicking a row.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                    className={cn(
                      'relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-8 pr-2 text-sm',
                      index === active && !option.reason && 'bg-accent text-accent-foreground',
                      option.reason && 'opacity-50',
                    )}
                  >
                    {isSelected && <Check className="absolute left-2 size-4" />}
                    <span className="min-w-0 flex-1">{option.label}</span>
                    {option.reason && <span className="shrink-0 text-xs text-muted-foreground">{option.reason}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No categories match “{query.trim()}”.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

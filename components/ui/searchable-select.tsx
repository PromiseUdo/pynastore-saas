'use client';

/*
 * components/ui/searchable-select.tsx
 *
 * A dropdown for choosing ONE value from a long list the page already has —
 * categories, Nigeria's 37 states — with a search box at the top and a list
 * capped in height that scrolls. A plain <Select> can't be searched, and on a
 * long list it runs off the screen.
 *
 * (For picking from a list too big to load — the catalogue, customers — use
 * search-picker.tsx, which asks the server.)
 *
 * Search matches every typed word anywhere in the label, ignoring case and
 * accents: "parfum women" finds "Women › Eau de Parfum". Labels starting with
 * what was typed are listed first, so Enter takes the likeliest one.
 * Keyboard: type to filter, ↑ ↓ to move, Enter to choose, Escape to close.
 */
import * as React from 'react';
import { Popover } from 'radix-ui';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePortalContainer } from './portal-container';

export type SearchableOption = {
  /** null is the "none" choice, e.g. "Uncategorised" */
  value: string | null;
  label: string;
  /** a reason it can't be chosen, shown beside it */
  disabledReason?: string | null;
};

type SearchableSelectProps = {
  id?: string;
  options: SearchableOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** shown on the button when nothing is chosen */
  placeholder?: string;
  /** what the list holds, plural: "categories", "states" */
  noun: string;
  /** for a picker with no visible <Label> */
  ariaLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
};

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = 'Choose',
  noun,
  ariaLabel,
  invalid,
  disabled,
  className,
}: SearchableSelectProps) {
  const container = usePortalContainer();
  const autoId = React.useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-list`;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);

  const searchable = React.useMemo(() => options.map((o) => ({ ...o, search: fold(o.label) })), [options]);

  const shown = React.useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return searchable;
    // The "none" choice only shows while nothing is typed. Names that start
    // with what was typed come first ("riv" → Rivers before Cross River),
    // then ones with a word starting with it, then the rest, each in list order.
    const rank = (text: string) => (text.startsWith(words[0]) ? 0 : text.includes(` ${words[0]}`) ? 1 : 2);
    return searchable
      .filter((o) => o.value !== null && words.every((w) => o.search.includes(w)))
      .map((o, i) => ({ o, i, r: rank(o.search) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ o }) => o);
  }, [searchable, query]);

  const selected = options.find((o) => o.value === value);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  };

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, shown]);

  const choose = (option: SearchableOption) => {
    if (option.disabledReason) return;
    onChange(option.value);
    setOpen(false);
  };

  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < shown.length; i += by) {
      if (!shown[i].disabledReason) return i;
    }
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => step(i, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => step(i, -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(step(-1, 1));
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(step(shown.length, -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
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
          aria-invalid={invalid ? true : undefined}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-left text-sm text-foreground',
            'ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
            className,
          )}
        >
          <span className={cn('line-clamp-1 min-w-0', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>

      <Popover.Portal container={container}>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            // Straight into the search box, not the first row.
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector('input')?.focus();
          }}
          className={cn(
            'z-50 w-[var(--radix-popover-trigger-width)] min-w-[14rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        >
          <div className="relative border-b">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              role="combobox"
              aria-label={`Search ${noun}`}
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
              placeholder={`Search ${noun}`}
              className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {shown.length ? (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel ?? noun}
              className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-2.75rem))] overflow-y-auto overscroll-contain p-1"
            >
              {shown.map((option, index) => {
                const isSelected = option.value === value;
                const reason = option.disabledReason;
                return (
                  <li
                    key={option.value ?? '__none__'}
                    id={`${baseId}-opt-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={reason ? true : undefined}
                    title={reason ?? undefined}
                    onMouseMove={() => !reason && setActive(index)}
                    // Keep focus in the search box while clicking a row.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                    className={cn(
                      'relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-8 pr-2 text-sm',
                      index === active && !reason && 'bg-accent text-accent-foreground',
                      reason && 'opacity-50',
                    )}
                  >
                    {isSelected && <Check className="absolute left-2 size-4" />}
                    <span className="min-w-0 flex-1">{option.label}</span>
                    {reason && <span className="shrink-0 text-xs text-muted-foreground">{reason}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No {noun} match “{query.trim()}”.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

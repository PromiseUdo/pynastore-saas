'use client';

/*
 * components/ui/search-picker.tsx
 *
 * The "type a few letters, pick the one you meant" box used by the till, the
 * invoice form, the campaign form and the picker that adds products to a store.
 *
 * It replaced a `<Select>` holding the whole catalogue. A select can't be
 * searched, and a shop with a thousand products can't be scrolled — so this
 * asks the server and shows what came back.
 *
 * What makes it usable rather than merely present:
 *   - the keyboard works: ↑ ↓ to move, Enter to take, Escape to dismiss, and
 *     the highlighted row is announced through aria-activedescendant;
 *   - a barcode scanner types fast and presses Enter, so a single exact
 *     match on Enter is taken immediately without anyone choosing;
 *   - it says which of the three states it is in — searching, nothing found,
 *     or type a bit more — instead of showing an empty box;
 *   - after a pick the field clears and keeps focus, so the next item can be
 *     scanned straight away.
 */
import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

export type SearchResult<T> = { success: true; data: T[] } | { success: false; error: string };

type SearchPickerProps<T> = {
  id: string;
  /** what the field is for, read by screen readers */
  label: string;
  placeholder?: string;
  /** runs on the server; debounced for you */
  onSearch: (query: string) => Promise<SearchResult<T>>;
  onPick: (item: T) => void;
  /** stable key for a result row */
  getKey: (item: T) => string;
  /** the row's own markup — keep it to two lines */
  renderItem: (item: T) => React.ReactNode;
  /** true when the row can't be chosen (out of stock, say) */
  isDisabled?: (item: T) => boolean;
  /** shown under the field when a search came back with nothing */
  emptyHint?: string;
  /** characters needed before searching at all */
  minLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

export function SearchPicker<T>({
  id,
  label,
  placeholder,
  onSearch,
  onPick,
  getKey,
  renderItem,
  isDisabled,
  emptyHint,
  minLength = 1,
  disabled,
  autoFocus,
  className,
}: SearchPickerProps<T>) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<T[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  const ready = query.trim().length >= minLength;

  React.useEffect(() => {
    if (!ready) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    /* One request per pause, not one per keystroke — and a scanner's whole
     * code arrives inside a single 250ms window. */
    const timer = setTimeout(async () => {
      const result = await onSearch(query.trim());
      if (cancelled) return;
      setSearching(false);
      setSearched(true);
      setActive(0);
      if (result.success) {
        setResults(result.data);
        setError(null);
      } else {
        setResults([]);
        setError(result.error);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, ready, onSearch]);

  const selectable = results.filter((item) => !isDisabled?.(item));

  function take(item: T) {
    if (isDisabled?.(item)) return;
    onPick(item);
    setQuery('');
    setResults([]);
    setSearched(false);
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setResults([]);
      setSearched(false);
      return;
    }
    if (results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      /* A scanner's code matches exactly one thing: take it without making
       * anyone press the down arrow first. */
      if (selectable.length === 1) take(selectable[0]);
      else if (results[active]) take(results[active]);
    }
  }

  const listId = `${id}-results`;

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results.length > 0 ? `${id}-option-${active}` : undefined}
        aria-label={label}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className="pl-8"
      />
      {searching && (
        <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover shadow-md"
        >
          {results.map((item, index) => {
            const off = Boolean(isDisabled?.(item));
            return (
              <li key={getKey(item)} role="none">
                <button
                  type="button"
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={off}
                  disabled={off}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => take(item)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                    index === active && !off && 'bg-muted',
                    off && 'opacity-50',
                  )}
                >
                  {renderItem(item)}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      {!error && searched && !searching && results.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {emptyHint ?? `Nothing matches “${query.trim()}”.`}
        </p>
      )}
    </div>
  );
}

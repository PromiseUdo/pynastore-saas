'use client';

/*
 * A text box with a small formatting toolbar — bold, heading, bulleted and
 * numbered lists, link — and a Write / Preview switch.
 *
 * The buttons only type the marks of the store's formatting language
 * (lib/storefront/pages/format.ts) into the box, so what is saved is plain
 * text, and the storefront renders it with the same parser and the same
 * PageBlocks the preview uses. Nothing here can put HTML on the store.
 *
 * Edits go in through the browser's own "insert text", so Ctrl/Cmd+Z undoes
 * a toolbar action like any typing. Ctrl/Cmd+B makes the selection bold.
 */
import * as React from 'react';
import { Bold, Heading, Link2, List, ListOrdered } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { PageBlocks } from '@/components/content/page-blocks';
import { parsePageBody } from '@/lib/storefront/pages/format';
import { changedRange, insertLink, toggleBold, toggleLines, type TextEdit } from '@/lib/storefront/pages/format-edit';
import { cn } from '@/lib/utils';

type Action = {
  key: string;
  label: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: (value: string, start: number, end: number) => TextEdit;
};

const ACTIONS: Action[] = [
  { key: 'bold', label: 'Bold', shortcut: 'B', icon: Bold, run: toggleBold },
  { key: 'heading', label: 'Heading', icon: Heading, run: (v, s, e) => toggleLines(v, s, e, 'heading') },
  { key: 'bullet', label: 'Bulleted list', icon: List, run: (v, s, e) => toggleLines(v, s, e, 'bullet') },
  { key: 'numbered', label: 'Numbered list', icon: ListOrdered, run: (v, s, e) => toggleLines(v, s, e, 'numbered') },
  { key: 'link', label: 'Link', icon: Link2, run: insertLink },
];

export function FormattedTextarea({
  id,
  value,
  onChange,
  maxLength,
  placeholder,
  disabled,
  invalid,
  className,
  rows,
  previewHeading,
  label,
  tab: tabProp,
  onTabChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  rows?: number;
  /** Shown above the preview, e.g. the page title. */
  previewHeading?: React.ReactNode;
  /** The field's visible label, rendered on the left of the toolbar row. */
  label?: React.ReactNode;
  /** Optional control of Write / Preview, e.g. to go back to Write on an error. */
  tab?: 'write' | 'preview';
  onTabChange?: (tab: 'write' | 'preview') => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [ownTab, setOwnTab] = React.useState<'write' | 'preview'>('write');
  const tab = tabProp ?? ownTab;
  const setTab = (next: 'write' | 'preview') => {
    setOwnTab(next);
    onTabChange?.(next);
  };
  const pendingSelection = React.useRef<[number, number] | null>(null);

  const blocks = React.useMemo(() => (tab === 'preview' ? parsePageBody(value) : []), [tab, value]);

  // Selection set after React has written a value it was handed directly.
  React.useLayoutEffect(() => {
    const box = ref.current;
    const sel = pendingSelection.current;
    if (!box || !sel) return;
    pendingSelection.current = null;
    box.setSelectionRange(sel[0], sel[1]);
  });

  const apply = (action: Action) => {
    const box = ref.current;
    if (!box || disabled) return;
    const edit = action.run(box.value, box.selectionStart, box.selectionEnd);
    if (maxLength && edit.value.length > maxLength) return;
    if (edit.value === box.value) return;

    box.focus();
    const { from, to, text } = changedRange(box.value, edit.value);
    box.setSelectionRange(from, to);
    // execCommand keeps the browser's undo history; it fires `input`, which
    // React turns into onChange. Where it isn't supported, set it directly.
    const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (inserted && box.value === edit.value) {
      box.setSelectionRange(edit.start, edit.end);
    } else {
      pendingSelection.current = [edit.start, edit.end];
      onChange(edit.value);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      apply(ACTIONS[0]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {label}
        <div role="tablist" aria-label="Write or preview" className="ml-auto inline-flex rounded-md border p-0.5">
          {(['write', 'preview'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`${id}-panel`}
              onClick={() => setTab(key)}
              className={cn(
                'h-7 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {key === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
        </div>
      </div>

      <div id={`${id}-panel`}>
        {tab === 'write' ? (
          <div
            className={cn(
              'overflow-hidden rounded-md border border-input bg-background transition-colors dark:bg-input/30',
              'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring',
              invalid && 'border-destructive',
              disabled && 'opacity-50',
            )}
          >
            <div role="toolbar" aria-label="Formatting" aria-controls={id} className="flex flex-wrap gap-0.5 border-b bg-muted/40 px-1 py-1">
              {ACTIONS.map((action) => {
                const Icon = action.icon;
                const title = action.shortcut ? `${action.label} (Ctrl/⌘+${action.shortcut})` : action.label;
                return (
                  <button
                    key={action.key}
                    type="button"
                    title={title}
                    aria-label={action.label}
                    disabled={disabled}
                    // Keep the selection in the box while the button is pressed.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply(action)}
                    className="inline-flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
            <Textarea
              ref={ref}
              id={id}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={disabled}
              rows={rows}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-invalid={invalid ? true : undefined}
              className={cn(
                'resize-y rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent disabled:opacity-100',
                className,
              )}
            />
          </div>
        ) : (
          <div className={cn('rounded-md border bg-card px-5 py-5', className)}>
            {previewHeading}
            {blocks.length ? (
              <PageBlocks blocks={blocks} preview nested={!previewHeading} className={previewHeading ? 'mt-4' : undefined} />
            ) : (
              <p className={cn('text-sm text-muted-foreground', previewHeading && 'mt-4')}>Nothing written yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

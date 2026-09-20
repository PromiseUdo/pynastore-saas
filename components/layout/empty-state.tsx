import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The shared "nothing here" panel (AGENTS.md §3): what the thing is, and the
 * one action that starts it. Use `variant="filtered"` when a search or filter
 * hid everything — that's a different message from an empty module.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'empty',
  className,
}: {
  icon?: React.ElementType;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: 'empty' | 'filtered';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed px-6 text-center',
        variant === 'empty' ? 'mx-auto max-w-lg py-14' : 'py-12',
        className,
      )}
    >
      {Icon && (
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
      <h2 className={cn('text-sm font-semibold text-foreground', Icon && 'mt-3')}>{title}</h2>
      {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

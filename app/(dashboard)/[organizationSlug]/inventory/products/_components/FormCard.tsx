import * as React from 'react';
import { cn } from '@/lib/utils';

/** A titled section of the product editor. `id` doubles as the anchor error links jump to. */
export function FormCard({
  id,
  title,
  description,
  actions,
  className,
  children,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('scroll-mt-20 rounded-lg border bg-card shadow-xs', className)}>
      <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b bg-background px-6 py-5 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {actions}
        </div>
      )}
    </div>
  );
}

/* Toolbar below the page header — for filters, search, bulk actions */
type PageToolbarProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageToolbar({ children, className }: PageToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b bg-background px-6 py-2.5",
        className
      )}
    >
      {children}
    </div>
  );
}

/* Standard scrollable page body */
type PageBodyProps = {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
};

export function PageBody({ children, className, padded = true }: PageBodyProps) {
  return (
    <div className={cn(padded && "px-6 py-6", className)}>{children}</div>
  );
}

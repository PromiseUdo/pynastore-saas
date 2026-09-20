import * as React from "react";
import { cn } from "@/lib/utils";

/* ─── Table wrapper ─────────────────────────────────────────────────────── */

type TableWrapperProps = React.ComponentProps<"div"> & {
  /** Makes the table scroll horizontally on small screens */
  scrollable?: boolean;
  /** Removes the outer border/shadow */
  flush?: boolean;
};

function TableWrapper({
  className,
  scrollable = true,
  flush = false,
  children,
  ...props
}: TableWrapperProps) {
  return (
    <div
      className={cn(
        !flush && "rounded-lg border bg-card shadow-xs",
        scrollable && "overflow-x-auto",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ─── Table root ────────────────────────────────────────────────────────── */

type TableProps = React.ComponentProps<"table"> & {
  /** Compact row height */
  dense?: boolean;
};

function Table({ className, dense, ...props }: TableProps) {
  return (
    <table
      data-dense={dense || undefined}
      className={cn(
        "w-full caption-bottom text-sm",
        className
      )}
      {...props}
    />
  );
}

/* ─── Table head ────────────────────────────────────────────────────────── */

function TableHead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn("border-b bg-muted/40", className)}
      {...props}
    />
  );
}

/* ─── Table body ────────────────────────────────────────────────────────── */

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn("divide-y divide-border", className)}
      {...props}
    />
  );
}

/* ─── Table footer ──────────────────────────────────────────────────────── */

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "border-t bg-muted/40 font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

/* ─── Table row ─────────────────────────────────────────────────────────── */

type TableRowProps = React.ComponentProps<"tr"> & {
  clickable?: boolean;
};

function TableRow({ className, clickable, ...props }: TableRowProps) {
  return (
    <tr
      className={cn(
        "transition-colors",
        clickable
          ? "cursor-pointer hover:bg-muted/50"
          : "hover:bg-muted/30",
        className
      )}
      {...props}
    />
  );
}

/* ─── Column header ─────────────────────────────────────────────────────── */

type TableColumnHeaderProps = React.ComponentProps<"th"> & {
  align?: "left" | "center" | "right";
  sortable?: boolean;
  sorted?: "asc" | "desc" | false;
};

function TableColumnHeader({
  className,
  align = "left",
  sortable,
  sorted,
  children,
  onClick,
  ...props
}: TableColumnHeaderProps) {
  return (
    <th
      className={cn(
        "h-10 px-4 text-xs font-medium text-muted-foreground whitespace-nowrap select-none",
        align === "left" && "text-left",
        align === "right" && "text-right",
        align === "center" && "text-center",
        sortable && "cursor-pointer hover:text-foreground transition-colors",
        className
      )}
      onClick={onClick}
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && (
          <span className="text-[10px] opacity-60">
            {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}
          </span>
        )}
      </span>
    </th>
  );
}

/* ─── Table cell ────────────────────────────────────────────────────────── */

type TableCellProps = React.ComponentProps<"td"> & {
  align?: "left" | "center" | "right";
  muted?: boolean;
};

function TableCell({
  className,
  align = "left",
  muted,
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn(
        "h-11 px-4 py-0 align-middle text-sm",
        "[table[data-dense]_&]:h-9",
        align === "right" && "text-right",
        align === "center" && "text-center",
        muted && "text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

/* ─── Table caption ─────────────────────────────────────────────────────── */

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/* ─── Empty state ───────────────────────────────────────────────────────── */

type TableEmptyProps = {
  colSpan: number;
  title?: string;
  description?: string;
  action?: React.ReactNode;
};

function TableEmpty({
  colSpan,
  title = "No results",
  description,
  action,
}: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="max-w-sm text-xs text-muted-foreground">
              {description}
            </p>
          )}
          {action}
        </div>
      </td>
    </tr>
  );
}

/* TablePagination lives in table-pagination.tsx (client component) */

export {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableFooter,
  TableRow,
  TableColumnHeader,
  TableCell,
  TableCaption,
  TableEmpty,
};

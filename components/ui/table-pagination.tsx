"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TablePaginationProps = {
  /** Controlled page — if omitted the component manages its own state */
  page?: number;
  defaultPage?: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange?: (page: number) => void;
  className?: string;
};

function TablePagination({
  page: controlledPage,
  defaultPage = 1,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  className,
}: TablePaginationProps) {
  const [internalPage, setInternalPage] = React.useState(defaultPage);
  const page = controlledPage ?? internalPage;

  function goTo(next: number) {
    if (next < 1 || next > totalPages) return;
    if (controlledPage === undefined) setInternalPage(next);
    onPageChange?.(next);
  }

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div
      className={cn(
        "flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground",
        className
      )}
    >
      <span className="tabular-nums">
        {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <button
          aria-label="Previous page"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          className="flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          ‹
        </button>
        <span className="px-2 tabular-nums text-xs">
          {page} / {totalPages}
        </span>
        <button
          aria-label="Next page"
          onClick={() => goTo(page + 1)}
          disabled={page >= totalPages}
          className="flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export { TablePagination };

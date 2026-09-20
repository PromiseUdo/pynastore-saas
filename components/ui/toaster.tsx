'use client';

import { Toaster as Sonner } from 'sonner';

/** Admin toast host — mounted once in DashboardLayout. Call `toast.success()`
 *  / `toast.error()` from 'sonner' after a mutation (see AGENTS.md §5). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border bg-popover text-popover-foreground text-sm shadow-lg',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
